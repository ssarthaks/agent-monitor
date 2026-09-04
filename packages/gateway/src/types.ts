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
  requestTimeoutMs?: number; // default: 30000 ms
  rateLimitPerMinute?: number; // default: 120 requests
  maxRestarts?: number; // default: 3 restarts before auto-quarantine
}

export type McpMethodCategory =
  | "side_effect"
  | "resource_read"
  | "tool_discovery"
  | "metadata_discovery"
  | "lifecycle"
  | "notification"
  | "unsupported";

export interface McpMethodSecurityEntry {
  method: string;
  category: McpMethodCategory;
  intercepted: boolean;
  normalized: boolean;
  policyEvaluated: boolean;
  riskEvaluated: boolean;
  killSwitchChecked: boolean;
  approvalPossible: boolean;
  audited: boolean;
  safePassthrough: boolean;
  reason: string;
}

export const MCP_METHOD_SECURITY_TABLE: Record<string, McpMethodSecurityEntry> =
  {
    "tools/call": {
      method: "tools/call",
      category: "side_effect",
      intercepted: true,
      normalized: true,
      policyEvaluated: true,
      riskEvaluated: true,
      killSwitchChecked: true,
      approvalPossible: true,
      audited: true,
      safePassthrough: false,
      reason:
        "Executes tools with filesystem, shell, network, or external side effects.",
    },
    "resources/read": {
      method: "resources/read",
      category: "resource_read",
      intercepted: true,
      normalized: true,
      policyEvaluated: true,
      riskEvaluated: true,
      killSwitchChecked: true,
      approvalPossible: true,
      audited: true,
      safePassthrough: false,
      reason:
        "Reads filesystem or external resource contents; must not bypass policy/containment.",
    },
    "tools/list": {
      method: "tools/list",
      category: "tool_discovery",
      intercepted: true,
      normalized: false,
      policyEvaluated: false,
      riskEvaluated: false,
      killSwitchChecked: false,
      approvalPossible: false,
      audited: true,
      safePassthrough: true,
      reason:
        "Discovers available tools; response inspected to establish cryptographic tool fingerprints.",
    },
    "resources/list": {
      method: "resources/list",
      category: "metadata_discovery",
      intercepted: false,
      normalized: false,
      policyEvaluated: false,
      riskEvaluated: false,
      killSwitchChecked: false,
      approvalPossible: false,
      audited: false,
      safePassthrough: true,
      reason:
        "Lists available resource metadata/URIs without reading their contents.",
    },
    "resources/templates/list": {
      method: "resources/templates/list",
      category: "metadata_discovery",
      intercepted: false,
      normalized: false,
      policyEvaluated: false,
      riskEvaluated: false,
      killSwitchChecked: false,
      approvalPossible: false,
      audited: false,
      safePassthrough: true,
      reason: "Lists URI templates for resources without retrieving data.",
    },
    "prompts/list": {
      method: "prompts/list",
      category: "metadata_discovery",
      intercepted: false,
      normalized: false,
      policyEvaluated: false,
      riskEvaluated: false,
      killSwitchChecked: false,
      approvalPossible: false,
      audited: false,
      safePassthrough: true,
      reason: "Lists available server prompt templates.",
    },
    "prompts/get": {
      method: "prompts/get",
      category: "metadata_discovery",
      intercepted: false,
      normalized: false,
      policyEvaluated: false,
      riskEvaluated: false,
      killSwitchChecked: false,
      approvalPossible: false,
      audited: false,
      safePassthrough: true,
      reason: "Fetches prompt messages without executing actions.",
    },
    initialize: {
      method: "initialize",
      category: "lifecycle",
      intercepted: false,
      normalized: false,
      policyEvaluated: false,
      riskEvaluated: false,
      killSwitchChecked: false,
      approvalPossible: false,
      audited: false,
      safePassthrough: true,
      reason:
        "MCP protocol handshake establishing protocol version and capabilities.",
    },
    ping: {
      method: "ping",
      category: "lifecycle",
      intercepted: false,
      normalized: false,
      policyEvaluated: false,
      riskEvaluated: false,
      killSwitchChecked: false,
      approvalPossible: false,
      audited: false,
      safePassthrough: true,
      reason: "Standard JSON-RPC liveness probe.",
    },
  };
