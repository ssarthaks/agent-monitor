import { ActionCategory, ActionKind } from "../actions/types.js";
import { RiskAssessment } from "../risk/types.js";
import { PolicyDecision } from "../policy/types.js";

export type EventType =
  | "session.started"
  | "session.ended"
  | "agent.message"
  | "policy.evaluated"
  | "approval.requested"
  | "approval.resolved"
  | "action.started"
  | "action.completed"
  | "action.failed"
  | "action.blocked"
  | "tool.discovered"
  | "tool.changed"
  | "behavioral.match"
  | "control.kill_switch_enabled"
  | "control.kill_switch_disabled"
  | "incident.created"
  | "incident.updated"
  | "mcp.started"
  | "mcp.crashed"
  | "mcp.quarantined"
  | "policy.changed";

export interface BaseEvent {
  id: string; // Unique event ID (e.g. "evt_01J...")
  sequence: number; // Monotonic per-session sequence (1, 2, 3...)
  sessionId: string; // Unique session ID (e.g. "ses_01J...")
  agentId: string; // e.g. "deepseek-coding-agent"
  timestamp: number; // Unix epoch milliseconds
  type: EventType;
  hash?: string; // SHA-256 cryptographic hash of canonical payload and prev_hash
  prevHash?: string | null; // Hash of preceding event in monotonic sequence (null for sequence 1)
}

export interface SessionStartedEvent extends BaseEvent {
  type: "session.started";
  agentName: string;
  provider: string;
  model: string;
  workspaceRoot: string;
  task: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  estimatedCostUsd: number;
}

export interface SessionSummary {
  totalActions: number;
  filesRead: number;
  filesWritten: number;
  commandsRun: number;
  errorsCount: number;
  overallRiskScore: number;
  approvedCount?: number;
  blockedCount?: number;
  usage?: TokenUsage;
}

export interface SessionEndedEvent extends BaseEvent {
  type: "session.ended";
  status: "completed" | "failed" | "interrupted";
  durationMs: number;
  summary: SessionSummary;
}

export interface AgentMessageEvent extends BaseEvent {
  type: "agent.message";
  content: string; // Visible text emitted by the agent
  step?: number;
  usage?: TokenUsage;
}

export interface PolicyEvaluatedEvent extends BaseEvent {
  type: "policy.evaluated";
  actionId: string;
  decision: PolicyDecision;
  matchedPolicies: string[];
  specificity: number;
  reason: string;
}

export interface ApprovalRequestedEvent extends BaseEvent {
  type: "approval.requested";
  approvalId: string;
  actionId: string;
  actionKind: ActionKind;
  category: ActionCategory;
  params: Record<string, any>;
  risk: RiskAssessment;
  reason: string;
  matchedPolicies: string[];
}

export interface ApprovalResolvedEvent extends BaseEvent {
  type: "approval.resolved";
  approvalId: string;
  actionId: string;
  decision: "approved" | "denied" | "expired";
  resolvedBy?: string | null;
}

export interface ActionStartedEvent extends BaseEvent {
  type: "action.started";
  actionId: string; // Unique ID correlating all events for this action
  kind: ActionKind;
  category: ActionCategory;
  params: Record<string, any>;
  risk: RiskAssessment;
}

export interface ActionCompletedEvent extends BaseEvent {
  type: "action.completed";
  actionId: string;
  kind: ActionKind;
  category: ActionCategory;
  params: Record<string, any>;
  result: any;
  durationMs: number;
  risk: RiskAssessment;
  metadata?: {
    diff?: string;
    bytesProcessed?: number;
    linesChanged?: number;
    exitCode?: number;
  };
}

export interface ActionFailedEvent extends BaseEvent {
  type: "action.failed";
  actionId: string;
  kind: ActionKind;
  category: ActionCategory;
  params: Record<string, any>;
  error: {
    message: string;
    code?: string;
  };
  durationMs: number;
  risk: RiskAssessment;
}

export interface ActionBlockedEvent extends BaseEvent {
  type: "action.blocked";
  actionId: string;
  kind: ActionKind;
  category: ActionCategory;
  params: Record<string, unknown>;
  reason: string;
  risk: RiskAssessment;
  policy?: {
    decision: PolicyDecision;
    matchedPolicies: string[];
    reason: string;
  };
}

export interface ToolDiscoveredEvent extends BaseEvent {
  type: "tool.discovered";
  toolName: string;
  source: string;
  fingerprint: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface ToolChangedEvent extends BaseEvent {
  type: "tool.changed";
  toolName: string;
  source: string;
  previousFingerprint: string;
  newFingerprint: string;
  diffSummary: string;
}

export interface BehavioralMatchEvent extends BaseEvent {
  type: "behavioral.match";
  match: {
    ruleId: string;
    name: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    reason: string;
    triggeringActionId: string;
    triggeringActionKind: string;
    priorActionIds: string[];
    timestamp: number;
  };
}

export interface KillSwitchEnabledEvent extends BaseEvent {
  type: "control.kill_switch_enabled";
  activatedBy: string;
  reason: string;
}

export interface KillSwitchDisabledEvent extends BaseEvent {
  type: "control.kill_switch_disabled";
  resumedBy: string;
}

export interface IncidentCreatedEvent extends BaseEvent {
  type: "incident.created";
  incidentId: string;
  incidentNumber: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  triggerType: string;
  title: string;
}

export interface IncidentUpdatedEvent extends BaseEvent {
  type: "incident.updated";
  incidentId: string;
  status: string;
  updatedBy?: string;
  notes?: string;
}

export interface McpStartedEvent extends BaseEvent {
  type: "mcp.started";
  sourceId: string;
  command: string;
  pid?: number;
}

export interface McpCrashedEvent extends BaseEvent {
  type: "mcp.crashed";
  sourceId: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string;
}

export interface McpQuarantinedEvent extends BaseEvent {
  type: "mcp.quarantined";
  sourceId: string;
  reason: string;
  quarantinedBy: string;
}

export interface PolicyChangedEvent extends BaseEvent {
  type: "policy.changed";
  action: "created" | "activated" | "rolled_back" | "rule_toggled";
  versionId?: string;
  ruleId?: string;
  actor: string;
}

export type AgentEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | AgentMessageEvent
  | PolicyEvaluatedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | ActionStartedEvent
  | ActionCompletedEvent
  | ActionFailedEvent
  | ActionBlockedEvent
  | ToolDiscoveredEvent
  | ToolChangedEvent
  | BehavioralMatchEvent
  | KillSwitchEnabledEvent
  | KillSwitchDisabledEvent
  | IncidentCreatedEvent
  | IncidentUpdatedEvent
  | McpStartedEvent
  | McpCrashedEvent
  | McpQuarantinedEvent
  | PolicyChangedEvent;

export interface AgentSession {
  id: string;
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  workspaceRoot: string;
  task: string;
  startedAt: number;
  endedAt?: number | null;
  status: "running" | "completed" | "failed" | "interrupted" | "killed";
  riskScore: number;
  summary?: SessionEndedEvent["summary"] | null;
}
