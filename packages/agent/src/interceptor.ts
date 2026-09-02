import {
  ActionCategory,
  ActionKind,
  ActionStartedEvent,
  ActionCompletedEvent,
  ActionFailedEvent,
  ActionBlockedEvent,
  PolicyEvaluatedEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  AgentEvent,
  AgentMessageEvent,
  SessionStartedEvent,
  SessionEndedEvent,
  RiskAnalyzer,
  PolicyEngine,
  ApprovalRequest,
} from '@agent-monitor/core';
import { ToolDefinition, ToolExecutionContext } from './runtime.js';
import { resolveSafeWorkspacePath } from './tools/guardrails.js';
import { ApprovalManager } from './approvals/manager.js';

export interface EventSink {
  emit(event: AgentEvent): Promise<void>;
}

export interface InterceptorOptions {
  sink: EventSink;
  riskAnalyzer?: RiskAnalyzer;
  policyEngine?: PolicyEngine;
  approvalManager?: ApprovalManager;
}

export class ActionInterceptor {
  private tools = new Map<string, ToolDefinition>();
  private riskAnalyzer: RiskAnalyzer;
  private policyEngine: PolicyEngine;
  private approvalManager?: ApprovalManager;
  private sink: EventSink;

  constructor(
    sinkOrOptions: EventSink | InterceptorOptions,
    riskAnalyzer: RiskAnalyzer = new RiskAnalyzer(),
    policyEngine: PolicyEngine = new PolicyEngine(),
    approvalManager?: ApprovalManager
  ) {
    if ('sink' in sinkOrOptions) {
      this.sink = sinkOrOptions.sink;
      this.riskAnalyzer = sinkOrOptions.riskAnalyzer || new RiskAnalyzer();
      this.policyEngine = sinkOrOptions.policyEngine || new PolicyEngine();
      this.approvalManager = sinkOrOptions.approvalManager;
    } else {
      this.sink = sinkOrOptions;
      this.riskAnalyzer = riskAnalyzer;
      this.policyEngine = policyEngine;
      this.approvalManager = approvalManager;
    }
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  async emitSessionStarted(event: Omit<SessionStartedEvent, 'id' | 'sequence' | 'type'>): Promise<void> {
    await this.sink.emit({
      ...event,
      id: this.generateId('evt'),
      sequence: 0,
      type: 'session.started',
    });
  }

  async emitSessionEnded(event: Omit<SessionEndedEvent, 'id' | 'sequence' | 'type'>): Promise<void> {
    await this.sink.emit({
      ...event,
      id: this.generateId('evt'),
      sequence: 0,
      type: 'session.ended',
    });
  }

  async emitAgentMessage(sessionId: string, agentId: string, content: string): Promise<void> {
    const event: AgentMessageEvent = {
      id: this.generateId('evt'),
      sequence: 0,
      sessionId,
      agentId,
      timestamp: Date.now(),
      type: 'agent.message',
      content,
    };
    await this.sink.emit(event);
  }

  /**
   * Evaluates policy and executes a tool with strict safety ordering.
   *
   * Ordering Guarantees:
   * 1. ALLOW: policy.evaluated -> action.started -> tool.execute() -> action.completed
   * 2. DENY: policy.evaluated -> action.blocked (tool never executes)
   * 3. ASK (approved): policy.evaluated -> approval.requested -> approval.resolved(approved) -> action.started -> tool.execute()
   * 4. ASK (denied/expired): policy.evaluated -> approval.requested -> approval.resolved -> action.blocked (tool never executes)
   */
  async invoke(toolName: string, rawParams: Record<string, any>, ctx: ToolExecutionContext): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: '${toolName}'`);
    }

    const actionId = this.generateId('act');
    const startTime = Date.now();

    // 1. Guardrails: Check Workspace Boundary
    let isOutsideWorkspace = false;
    if (rawParams.path) {
      const pathCheck = resolveSafeWorkspacePath(rawParams.path, ctx.workspaceRoot);
      isOutsideWorkspace = pathCheck.isOutsideWorkspace;
    }

    // 2. Risk Assessment (Pre-execution)
    const risk = this.riskAnalyzer.analyze(tool.actionKind, rawParams, { isOutsideWorkspace });

    // 3. Deterministic Policy Evaluation
    const policyEval = this.policyEngine.evaluate(
      {
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        risk,
      },
      {
        workspaceRoot: ctx.workspaceRoot,
        agentId: ctx.agentId,
        isOutsideWorkspace,
      }
    );

    // 4. Emit policy.evaluated Event
    const policyEvent: PolicyEvaluatedEvent = {
      id: this.generateId('evt'),
      sequence: 0,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      timestamp: Date.now(),
      type: 'policy.evaluated',
      actionId,
      decision: policyEval.decision,
      matchedPolicies: policyEval.matchedPolicies,
      specificity: policyEval.specificity,
      reason: policyEval.reason,
    };
    await this.sink.emit(policyEvent);

    // 5. Handle Policy Decisions
    if (policyEval.decision === 'DENY') {
      const blockedEvent: ActionBlockedEvent = {
        id: this.generateId('evt'),
        sequence: 0,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: 'action.blocked',
        actionId,
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        reason: policyEval.reason,
        risk,
        policy: {
          decision: 'DENY',
          matchedPolicies: policyEval.matchedPolicies,
          reason: policyEval.reason,
        },
      };
      await this.sink.emit(blockedEvent);
      throw new Error(`Security Violation: Action '${tool.actionKind}' was blocked by policy: ${policyEval.reason}`);
    }

    if (policyEval.decision === 'ASK') {
      const approvalId = this.generateId('app');
      const approvalRequest: ApprovalRequest = {
        id: approvalId,
        actionId,
        sessionId: ctx.sessionId,
        actionKind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        risk,
        reason: policyEval.reason,
        matchedPolicies: policyEval.matchedPolicies,
        status: 'pending',
        createdAt: Date.now(),
      };

      if (this.approvalManager) {
        await this.approvalManager.createApproval(approvalRequest);
      }

      const reqEvent: ApprovalRequestedEvent = {
        id: this.generateId('evt'),
        sequence: 0,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: 'approval.requested',
        approvalId,
        actionId,
        actionKind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        risk,
        reason: policyEval.reason,
        matchedPolicies: policyEval.matchedPolicies,
      };
      await this.sink.emit(reqEvent);

      // Genuinely pause and wait for human resolution
      const resolution = this.approvalManager
        ? await this.approvalManager.waitForResolution(approvalId, this.policyEngine.getTimeoutMs())
        : { decision: 'denied' as const, resolvedBy: 'no_approval_manager' };

      // Emit resolved event only if no external manager/server managed the single authoritative emission
      if (!this.approvalManager) {
        const resEvent: ApprovalResolvedEvent = {
          id: this.generateId('evt'),
          sequence: 0,
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          timestamp: Date.now(),
          type: 'approval.resolved',
          approvalId,
          actionId,
          decision: resolution.decision,
          resolvedBy: resolution.resolvedBy,
        };
        await this.sink.emit(resEvent);
      }

      if (resolution.decision !== 'approved') {
        const blockedEvent: ActionBlockedEvent = {
          id: this.generateId('evt'),
          sequence: 0,
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          timestamp: Date.now(),
          type: 'action.blocked',
          actionId,
          kind: tool.actionKind,
          category: tool.category,
          params: rawParams,
          reason:
            resolution.decision === 'expired'
              ? 'Action blocked: Approval request timed out'
              : 'Action blocked: Denied by user',
          risk,
          policy: {
            decision: 'ASK',
            matchedPolicies: policyEval.matchedPolicies,
            reason: policyEval.reason,
          },
        };
        await this.sink.emit(blockedEvent);
        throw new Error(
          resolution.decision === 'expired'
            ? `Policy Error: Approval request timed out for '${tool.actionKind}'`
            : `Policy Error: Action '${tool.actionKind}' was denied by user`
        );
      }
    }

    // 6. Action Execution (Only reached if ALLOW or Approved)
    const startedEvent: ActionStartedEvent = {
      id: this.generateId('evt'),
      sequence: 0,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      timestamp: startTime,
      type: 'action.started',
      actionId,
      kind: tool.actionKind,
      category: tool.category,
      params: rawParams,
      risk,
    };
    await this.sink.emit(startedEvent);

    try {
      const result = await tool.execute(rawParams, ctx);
      const durationMs = Date.now() - startTime;

      const metadata: ActionCompletedEvent['metadata'] = {};
      if (tool.actionKind === 'file.write' && result) {
        metadata.diff = result.diff;
        metadata.linesChanged = result.linesChanged;
        metadata.bytesProcessed = result.bytesWritten;
      } else if (tool.actionKind === 'process.exec' && result) {
        metadata.exitCode = result.exitCode;
      } else if (tool.actionKind === 'file.read' && result) {
        metadata.bytesProcessed = result.bytesRead;
      }

      const completedEvent: ActionCompletedEvent = {
        id: this.generateId('evt'),
        sequence: 0,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: 'action.completed',
        actionId,
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        result,
        durationMs,
        risk,
        metadata,
      };
      await this.sink.emit(completedEvent);

      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      const failedEvent: ActionFailedEvent = {
        id: this.generateId('evt'),
        sequence: 0,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: 'action.failed',
        actionId,
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        error: {
          message: err.message || 'Tool execution failed',
        },
        durationMs,
        risk,
      };
      await this.sink.emit(failedEvent);

      throw err;
    }
  }

  private generateId(prefix: string): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${ts}_${rand}`;
  }
}
