import { ActionCategory, ActionKind } from "../actions/types.js";
import { RiskAssessment } from "../risk/types.js";

export type PolicyDecision = "ALLOW" | "DENY" | "ASK";

export interface PolicyRuleWhen {
  priorSensitiveRead?: boolean;
  priorWorkspaceWrite?: boolean;
  source?: string; // e.g. "mcp", "runtime", "mcp:filesystem"
}

export interface PolicyRule {
  id: string;
  name?: string;
  action?: string; // e.g. "file.read", "file.*", "process.exec", "*"
  path?: string; // e.g. "**/.env*", "~/.ssh/**", "credentials.json"
  command?: string; // e.g. "git push *", "npm test", "rm -rf *"
  decision: PolicyDecision;
  reason?: string;
  agentId?: string;
  maxRiskScore?: number;
  when?: PolicyRuleWhen;
  enabled?: boolean; // Default: true. If false, rule is bypassed in evaluation
}

export interface PolicyVersion {
  id: string;
  versionNumber: number;
  name: string;
  description?: string;
  rules: PolicyRule[];
  defaultDecision: PolicyDecision;
  timeoutMs: number;
  isActive: boolean;
  createdAt: number;
  createdBy: string;
  changeSummary?: string;
  hash: string;
}

export interface PolicyVersionDiff {
  versionA: number;
  versionB: number;
  addedRules: PolicyRule[];
  removedRules: PolicyRule[];
  modifiedRules: {
    ruleId: string;
    before: PolicyRule;
    after: PolicyRule;
    changes: string[];
  }[];
  defaultDecisionChanged?: { before: PolicyDecision; after: PolicyDecision };
}

export interface PolicyMutationAudit {
  id: string;
  versionId: string;
  action: "created" | "activated" | "rolled_back" | "rule_toggled";
  actor: string;
  timestamp: number;
  details: Record<string, any>;
}

export interface PolicyConfig {
  policy?: {
    default?: PolicyDecision;
    timeoutMs?: number;
  };
  approval?: {
    timeoutMs?: number;
  };
  rules?: PolicyRule[];
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  matchedPolicies: string[];
  specificity: number;
  reason: string;
  rule?: PolicyRule;
}

export interface PolicyActionContext {
  workspaceRoot: string;
  agentId?: string;
  isOutsideWorkspace?: boolean;
  isToolMutated?: boolean;
  hasPriorSensitiveRead?: boolean;
  hasPriorWorkspaceWrite?: boolean;
  source?: string;
}

export interface EvaluatedAction {
  kind: ActionKind | string;
  category?: ActionCategory | string;
  params: Record<string, any>;
  risk?: RiskAssessment;
  source?: any;
}
