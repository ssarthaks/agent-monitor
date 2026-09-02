import {
  ActionCategory,
  ActionKind,
  ActionStartedEvent,
  ActionCompletedEvent,
  ActionFailedEvent,
  ActionBlockedEvent,
  AgentEvent,
  AgentMessageEvent,
  SessionStartedEvent,
  SessionEndedEvent,
  RiskAnalyzer,
} from '@agent-monitor/core';
import { ToolDefinition, ToolExecutionContext } from './runtime.js';
import { resolveSafeWorkspacePath } from './tools/guardrails.js';

export interface EventSink {
  emit(event: AgentEvent): Promise<void>;
}

export class ActionInterceptor {
  private tools = new Map<string, ToolDefinition>();
  private riskAnalyzer: RiskAnalyzer;
  private sink: EventSink;

  constructor(sink: EventSink, riskAnalyzer: RiskAnalyzer = new RiskAnalyzer()) {
    this.sink = sink;
    this.riskAnalyzer = riskAnalyzer;
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

  async invoke(toolName: string, rawParams: Record<string, any>, ctx: ToolExecutionContext): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: '${toolName}'`);
    }

    const actionId = this.generateId('act');
    const startTime = Date.now();

    let isOutsideWorkspace = false;
    if (rawParams.path) {
      const pathCheck = resolveSafeWorkspacePath(rawParams.path, ctx.workspaceRoot);
      isOutsideWorkspace = pathCheck.isOutsideWorkspace;
    }

    const preRisk = this.riskAnalyzer.analyze(tool.actionKind, rawParams, { isOutsideWorkspace });

    if (isOutsideWorkspace) {
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
        reason: `Target path '${rawParams.path}' is outside designated workspace root`,
        risk: preRisk,
      };
      await this.sink.emit(blockedEvent);
      throw new Error(`Security Violation: Target path is outside workspace root`);
    }

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
      risk: preRisk,
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
        risk: preRisk,
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
        risk: preRisk,
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
