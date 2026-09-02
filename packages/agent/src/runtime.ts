export interface ToolExecutionContext {
  sessionId: string;
  agentId: string;
  workspaceRoot: string;
}

export interface ToolDefinition<TParams = any, TResult = any> {
  name: string;
  actionKind: string;
  category: 'file' | 'process' | 'network' | 'system' | 'custom';
  description: string;
  parameters: Record<string, any>; // JSON Schema
  execute: (params: TParams, context: ToolExecutionContext) => Promise<TResult>;
}

export interface AgentRuntime {
  readonly agentId: string;
  readonly agentName: string;
  readonly provider: string;
  readonly model: string;

  run(task: string): Promise<void>;
}
