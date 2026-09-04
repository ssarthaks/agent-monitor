import { ActionCategory, ActionKind } from "../actions/types.js";

export type BehavioralSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SensitiveAccessRecord {
  actionId: string;
  path: string;
  timestamp: number;
  sensitivityReason: string;
}

export interface WorkspaceWriteRecord {
  actionId: string;
  path: string;
  timestamp: number;
}

export interface ProcessExecRecord {
  actionId: string;
  command: string;
  timestamp: number;
}

export interface BlockedActionRecord {
  actionId: string;
  kind: string;
  reason: string;
  timestamp: number;
}

export interface MutatedToolRecord {
  actionId: string;
  toolName: string;
  timestamp: number;
}

export interface BehavioralContext {
  sessionId: string;
  sensitiveReads: SensitiveAccessRecord[];
  workspaceWrites: WorkspaceWriteRecord[];
  executedCommands: ProcessExecRecord[];
  blockedActions: BlockedActionRecord[];
  mutatedTools: MutatedToolRecord[];
  priorMatches: BehavioralMatch[];
}

export interface BehavioralMatch {
  ruleId: string;
  name: string;
  severity: BehavioralSeverity;
  reason: string;
  triggeringActionId: string;
  triggeringActionKind: string;
  priorActionIds: string[];
  timestamp: number;
}

export interface BehavioralRule {
  id: string;
  name: string;
  description: string;
  severity: BehavioralSeverity;
  evaluate(
    context: BehavioralContext,
    action: {
      kind: ActionKind | string;
      category?: ActionCategory | string;
      params: Record<string, any>;
      actionId?: string;
    },
  ): BehavioralMatch | null;
}
