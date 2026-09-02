import { ActionCategory, ActionKind } from '../actions/types.js';
import { RiskAssessment } from '../risk/types.js';

export type EventType =
  | 'session.started'
  | 'session.ended'
  | 'agent.message'
  | 'action.started'
  | 'action.completed'
  | 'action.failed'
  | 'action.blocked';

export interface BaseEvent {
  id: string;              // Unique event ID (e.g. "evt_01J...")
  sequence: number;        // Monotonic per-session sequence (1, 2, 3...)
  sessionId: string;       // Unique session ID (e.g. "ses_01J...")
  agentId: string;         // e.g. "deepseek-coding-agent"
  timestamp: number;       // Unix epoch milliseconds
  type: EventType;
}

export interface SessionStartedEvent extends BaseEvent {
  type: 'session.started';
  agentName: string;
  provider: string;
  model: string;
  workspaceRoot: string;
  task: string;
}

export interface SessionEndedEvent extends BaseEvent {
  type: 'session.ended';
  status: 'completed' | 'failed' | 'interrupted';
  durationMs: number;
  summary: {
    totalActions: number;
    filesRead: number;
    filesWritten: number;
    commandsRun: number;
    errorsCount: number;
    overallRiskScore: number;
  };
}

export interface AgentMessageEvent extends BaseEvent {
  type: 'agent.message';
  content: string; // Visible text emitted by the agent
}

export interface ActionStartedEvent extends BaseEvent {
  type: 'action.started';
  actionId: string; // Unique ID correlating all events for this action
  kind: ActionKind;
  category: ActionCategory;
  params: Record<string, any>;
  risk: RiskAssessment;
}

export interface ActionCompletedEvent extends BaseEvent {
  type: 'action.completed';
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
  type: 'action.failed';
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
  type: 'action.blocked';
  actionId: string;
  kind: ActionKind;
  category: ActionCategory;
  params: Record<string, unknown>;
  reason: string;
  risk: RiskAssessment;
}

export type AgentEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | AgentMessageEvent
  | ActionStartedEvent
  | ActionCompletedEvent
  | ActionFailedEvent
  | ActionBlockedEvent;

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
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  riskScore: number;
  summary?: SessionEndedEvent['summary'] | null;
}
