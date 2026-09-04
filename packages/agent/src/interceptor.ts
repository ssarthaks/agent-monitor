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
  TokenUsage,
  BehavioralEngine,
  computeActionContextHash,
  redactSecretsDeep,
} from "@agent-monitor/core";
import { ToolDefinition, ToolExecutionContext } from "./runtime.js";
import { resolveSafeWorkspacePath } from "./tools/guardrails.js";
import { ApprovalManager } from "./approvals/manager.js";

export interface EventSink {
  emit(event: AgentEvent): Promise<void>;
}

export interface InterceptorOptions {
  sink: EventSink;
  riskAnalyzer?: RiskAnalyzer;
  policyEngine?: PolicyEngine;
  approvalManager?: ApprovalManager;
  behavioralEngine?: BehavioralEngine;
  isKillSwitchActive?: (sessionId: string) => boolean;
  isQuarantined?: (sourceId: string) => boolean;
}

export class ActionInterceptor {
  private tools = new Map<string, ToolDefinition>();
  private riskAnalyzer: RiskAnalyzer;
  private policyEngine: PolicyEngine;
  private approvalManager?: ApprovalManager;
  private behavioralEngine?: BehavioralEngine;
  private isKillSwitchActive?: (sessionId: string) => boolean;
  private isQuarantined?: (sourceId: string) => boolean;
  private sink: EventSink;
  private sessionSequences = new Map<string, number>();

  private getNextSequence(sessionId: string): number {
    const current = this.sessionSequences.get(sessionId) ?? 0;
    const next = current + 1;
    this.sessionSequences.set(sessionId, next);
    return next;
  }

  constructor(
    sinkOrOptions: EventSink | InterceptorOptions,
    riskAnalyzer: RiskAnalyzer = new RiskAnalyzer(),
    policyEngine: PolicyEngine = new PolicyEngine(),
    approvalManager?: ApprovalManager,
    behavioralEngine?: BehavioralEngine,
  ) {
    if ("sink" in sinkOrOptions) {
      this.sink = sinkOrOptions.sink;
      this.riskAnalyzer = sinkOrOptions.riskAnalyzer || new RiskAnalyzer();
      this.policyEngine = sinkOrOptions.policyEngine || new PolicyEngine();
      this.approvalManager = sinkOrOptions.approvalManager;
      this.behavioralEngine = sinkOrOptions.behavioralEngine;
      this.isKillSwitchActive = sinkOrOptions.isKillSwitchActive;
      this.isQuarantined = sinkOrOptions.isQuarantined;
    } else {
      this.sink = sinkOrOptions;
      this.riskAnalyzer = riskAnalyzer;
      this.policyEngine = policyEngine;
      this.approvalManager = approvalManager;
      this.behavioralEngine = behavioralEngine;
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

  async emitSessionStarted(
    event: Omit<SessionStartedEvent, "id" | "sequence" | "type">,
  ): Promise<void> {
    await this.sink.emit({
      ...event,
      id: this.generateId("evt"),
      sequence: this.getNextSequence(event.sessionId),
      type: "session.started",
    });
  }

  async emitSessionEnded(
    event: Omit<SessionEndedEvent, "id" | "sequence" | "type">,
  ): Promise<void> {
    await this.sink.emit({
      ...event,
      id: this.generateId("evt"),
      sequence: this.getNextSequence(event.sessionId),
      type: "session.ended",
    });
  }

  async emitAgentMessage(
    sessionId: string,
    agentId: string,
    content: string,
    usage?: TokenUsage,
    step?: number,
  ): Promise<void> {
    const event: AgentMessageEvent = {
      id: this.generateId("evt"),
      sequence: this.getNextSequence(sessionId),
      sessionId,
      agentId,
      timestamp: Date.now(),
      type: "agent.message",
      content,
      usage,
      step,
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
  async invoke(
    toolName: string,
    rawParams: Record<string, any>,
    ctx: ToolExecutionContext,
  ): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: '${toolName}'`);
    }

    const actionId = this.generateId("act");
    const startTime = Date.now();

    // 0. Kill Switch Check (Authoritative Local Circuit Breaker)
    if (this.isKillSwitchActive && this.isKillSwitchActive(ctx.sessionId)) {
      const blockedEvent: ActionBlockedEvent = {
        id: this.generateId("evt"),
        sequence: this.getNextSequence(ctx.sessionId),
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: "action.blocked",
        actionId,
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        reason: "Execution blocked: Session was killed by operator kill switch",
        risk: {
          level: "CRITICAL",
          score: 100,
          flags: [
            {
              ruleId: "KILL_SWITCH_ACTIVE",
              description: "Session killed by operator kill switch",
              severity: "CRITICAL",
              scoreImpact: 100,
            },
          ],
        },
        policy: {
          decision: "DENY",
          matchedPolicies: ["authoritative-kill-switch"],
          reason: "Session killed by operator",
        },
      };
      await this.sink.emit(blockedEvent);
      throw new Error("Action execution blocked by operator kill switch");
    }

    // 0.05 Source Quarantine Check
    if (
      this.isQuarantined &&
      (this.isQuarantined("native") || this.isQuarantined(ctx.agentId))
    ) {
      const blockedEvent: ActionBlockedEvent = {
        id: this.generateId("evt"),
        sequence: this.getNextSequence(ctx.sessionId),
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: "action.blocked",
        actionId,
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        reason: "Execution blocked: Agent runtime or source is quarantined",
        risk: {
          level: "CRITICAL",
          score: 100,
          flags: [
            {
              ruleId: "SOURCE_QUARANTINED",
              description: "Action attempted from quarantined source",
              severity: "CRITICAL",
              scoreImpact: 100,
            },
          ],
        },
        policy: {
          decision: "DENY",
          matchedPolicies: ["authoritative-source-quarantine"],
          reason: "Source is quarantined",
        },
      };
      await this.sink.emit(blockedEvent);
      throw new Error("Action execution blocked: Source is quarantined");
    }

    // 0.1 Behavioral Engine Evaluation
    let hasPriorSensitiveRead = false;
    let hasPriorWorkspaceWrite = false;
    if (this.behavioralEngine) {
      const bCtx = this.behavioralEngine.getContext(ctx.sessionId);
      hasPriorSensitiveRead = bCtx.sensitiveReads.length > 0;
      hasPriorWorkspaceWrite = bCtx.workspaceWrites.length > 0;

      const bMatches = this.behavioralEngine.evaluate(ctx.sessionId, {
        actionId,
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
      });

      for (const match of bMatches) {
        await this.sink.emit({
          id: this.generateId("evt"),
          sequence: this.getNextSequence(ctx.sessionId),
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          timestamp: Date.now(),
          type: "behavioral.match",
          match,
        } as any);
      }
    }

    // 1. Guardrails: Check Workspace Boundary
    let isOutsideWorkspace = false;
    if (rawParams.path) {
      const pathCheck = resolveSafeWorkspacePath(
        rawParams.path,
        ctx.workspaceRoot,
      );
      isOutsideWorkspace = pathCheck.isOutsideWorkspace;
    }

    // 2. Risk Assessment (Pre-execution)
    const risk = this.riskAnalyzer.analyze(tool.actionKind, rawParams, {
      isOutsideWorkspace,
    });

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
        hasPriorSensitiveRead,
        hasPriorWorkspaceWrite,
      },
    );

    // 4. Emit policy.evaluated Event
    const policyEvent: PolicyEvaluatedEvent = {
      id: this.generateId("evt"),
      sequence: this.getNextSequence(ctx.sessionId),
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      timestamp: Date.now(),
      type: "policy.evaluated",
      actionId,
      decision: policyEval.decision,
      matchedPolicies: policyEval.matchedPolicies,
      specificity: policyEval.specificity,
      reason: policyEval.reason,
    };
    await this.sink.emit(policyEvent);

    // 5. Handle Policy Decisions
    if (policyEval.decision === "DENY") {
      const blockedEvent: ActionBlockedEvent = {
        id: this.generateId("evt"),
        sequence: this.getNextSequence(ctx.sessionId),
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: "action.blocked",
        actionId,
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        reason: policyEval.reason,
        risk,
        policy: {
          decision: "DENY",
          matchedPolicies: policyEval.matchedPolicies,
          reason: policyEval.reason,
        },
      };
      await this.sink.emit(blockedEvent);
      throw new Error(
        `Security Violation: Action '${tool.actionKind}' was blocked by policy: ${policyEval.reason}`,
      );
    }

    if (policyEval.decision === "ASK") {
      const approvalId = this.generateId("app");
      const initialPolicyVersion = this.policyEngine.getVersion();
      const expiresAt = Date.now() + this.policyEngine.getTimeoutMs();
      const actionContextHash = computeActionContextHash({
        sessionId: ctx.sessionId,
        actionKind: tool.actionKind,
        params: rawParams,
        source: "native",
        policyVersion: initialPolicyVersion,
        riskScore: risk.score,
      });

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
        status: "pending",
        createdAt: Date.now(),
        policyVersion: initialPolicyVersion,
        expiresAt,
        actionContextHash,
      };

      if (this.approvalManager) {
        await this.approvalManager.createApproval(approvalRequest);
      }

      const reqEvent: ApprovalRequestedEvent = {
        id: this.generateId("evt"),
        sequence: this.getNextSequence(ctx.sessionId),
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: "approval.requested",
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
        ? await this.approvalManager.waitForResolution(
            approvalId,
            this.policyEngine.getTimeoutMs(),
          )
        : { decision: "denied" as const, resolvedBy: "no_approval_manager" };

      // Emit resolved event only if no external manager/server managed the single authoritative emission
      if (!this.approvalManager) {
        const resEvent: ApprovalResolvedEvent = {
          id: this.generateId("evt"),
          sequence: this.getNextSequence(ctx.sessionId),
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          timestamp: Date.now(),
          type: "approval.resolved",
          approvalId,
          actionId,
          decision: resolution.decision,
          resolvedBy: resolution.resolvedBy,
        };
        await this.sink.emit(resEvent);
      }

      if (resolution.decision !== "approved") {
        const blockedEvent: ActionBlockedEvent = {
          id: this.generateId("evt"),
          sequence: this.getNextSequence(ctx.sessionId),
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          timestamp: Date.now(),
          type: "action.blocked",
          actionId,
          kind: tool.actionKind,
          category: tool.category,
          params: rawParams,
          reason:
            resolution.decision === "expired"
              ? "Action blocked: Approval request timed out"
              : "Action blocked: Denied by user",
          risk,
          policy: {
            decision: "ASK",
            matchedPolicies: policyEval.matchedPolicies,
            reason: policyEval.reason,
          },
        };
        await this.sink.emit(blockedEvent);
        throw new Error(
          resolution.decision === "expired"
            ? `Policy Error: Approval request timed out for '${tool.actionKind}'`
            : `Policy Error: Action '${tool.actionKind}' was denied by user`,
        );
      }

      // Post-Approval Security Revalidation
      if (Date.now() > expiresAt) {
        throw new Error(
          `Policy Error: Approval request expired for '${tool.actionKind}'`,
        );
      }

      const currentPolicyVersion = this.policyEngine.getVersion();
      if (currentPolicyVersion !== initialPolicyVersion) {
        throw new Error(
          `Policy Error: Policy version changed (from v${initialPolicyVersion} to v${currentPolicyVersion}) while approval was pending; action must be re-evaluated`,
        );
      }

      const recomputedHash = computeActionContextHash({
        sessionId: ctx.sessionId,
        actionKind: tool.actionKind,
        params: rawParams,
        source: "native",
        policyVersion: currentPolicyVersion,
        riskScore: risk.score,
      });
      if (recomputedHash !== actionContextHash) {
        throw new Error(
          `Security Violation: Action context hash mismatch between approval and execution (possible substitution or parameter tampering)`,
        );
      }
    }

    // 5.1 Post-Approval / Pre-Execution Kill Switch Check
    if (this.isKillSwitchActive && this.isKillSwitchActive(ctx.sessionId)) {
      const blockedEvent: ActionBlockedEvent = {
        id: this.generateId("evt"),
        sequence: this.getNextSequence(ctx.sessionId),
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: "action.blocked",
        actionId,
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        reason:
          "Execution blocked: Session was killed by operator kill switch prior to execution",
        risk: {
          level: "CRITICAL",
          score: 100,
          flags: [
            {
              ruleId: "KILL_SWITCH_ACTIVE",
              description: "Session killed by operator kill switch",
              severity: "CRITICAL",
              scoreImpact: 100,
            },
          ],
        },
        policy: {
          decision: "DENY",
          matchedPolicies: ["authoritative-kill-switch"],
          reason: "Session killed by operator",
        },
      };
      await this.sink.emit(blockedEvent);
      throw new Error("Action execution blocked by operator kill switch");
    }

    if (
      this.isQuarantined &&
      (this.isQuarantined("native") || this.isQuarantined(ctx.agentId))
    ) {
      throw new Error(
        "Action execution blocked: Source was quarantined prior to execution",
      );
    }

    // 6. Action Execution (Only reached if ALLOW or Approved)
    const startedEvent: ActionStartedEvent = {
      id: this.generateId("evt"),
      sequence: this.getNextSequence(ctx.sessionId),
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      timestamp: startTime,
      type: "action.started",
      actionId,
      kind: tool.actionKind,
      category: tool.category,
      params: rawParams,
      risk,
    };
    await this.sink.emit(startedEvent);

    try {
      const rawResult = await tool.execute(rawParams, ctx);
      const redaction = redactSecretsDeep(rawResult);
      const result = redaction.value;

      if (redaction.hasSecrets) {
        risk.flags.push({
          ruleId: "SECRET_LEAK_REDACTED",
          description: `Detected and redacted secrets in tool result: ${redaction.types.join(", ")}`,
          severity: "CRITICAL",
          scoreImpact: 30,
        });
        risk.score = Math.min(100, risk.score + 30);
        if (risk.score >= 75) risk.level = "CRITICAL";
        else if (risk.score >= 50) risk.level = "HIGH";
      }

      const durationMs = Date.now() - startTime;

      const metadata: ActionCompletedEvent["metadata"] = {};
      if (tool.actionKind === "file.write" && result) {
        metadata.diff = result.diff;
        metadata.linesChanged = result.linesChanged;
        metadata.bytesProcessed = result.bytesWritten;
      } else if (tool.actionKind === "process.exec" && result) {
        metadata.exitCode = result.exitCode;
      } else if (tool.actionKind === "file.read" && result) {
        metadata.bytesProcessed = result.bytesRead;
      }

      if (redaction.hasSecrets) {
        (metadata as any).secretLeakDetected = true;
        (metadata as any).secretTypes = redaction.types;
      }

      const completedEvent: ActionCompletedEvent = {
        id: this.generateId("evt"),
        sequence: this.getNextSequence(ctx.sessionId),
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: "action.completed",
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

      if (this.behavioralEngine) {
        this.behavioralEngine.recordAction(ctx.sessionId, {
          actionId,
          kind: tool.actionKind,
          category: tool.category,
          params: rawParams,
        });
      }

      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      const failedEvent: ActionFailedEvent = {
        id: this.generateId("evt"),
        sequence: this.getNextSequence(ctx.sessionId),
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        timestamp: Date.now(),
        type: "action.failed",
        actionId,
        kind: tool.actionKind,
        category: tool.category,
        params: rawParams,
        error: {
          message: err.message || "Tool execution failed",
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
