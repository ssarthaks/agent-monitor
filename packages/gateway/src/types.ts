import {
  PolicyEngine,
  RiskAnalyzer,
  BehavioralEngine,
  AgentEvent,
} from "@agent-monitor/core";
import { SessionRepository } from "@agent-monitor/server";
import { ApprovalManager, EventSink } from "@agent-monitor/agent";

export interface ToolGateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export interface McpProxyOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  sessionId: string;
  agentId?: string;
  agentName?: string;
  workspaceRoot: string;
  repository: SessionRepository;
  policyEngine: PolicyEngine;
  riskAnalyzer?: RiskAnalyzer;
  behavioralEngine?: BehavioralEngine;
  eventSink: EventSink;
  approvalManager?: ApprovalManager;
  clientInputStream?: NodeJS.ReadableStream;
  clientOutputStream?: NodeJS.WritableStream;
  logStream?: NodeJS.WritableStream;
  serverName?: string;
}
