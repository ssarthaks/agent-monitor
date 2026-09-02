import { ActionCategory, ActionKind } from '../actions/types.js';
import { RiskAssessment } from '../risk/types.js';

export type PolicyDecision = 'ALLOW' | 'DENY' | 'ASK';

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
}

export interface EvaluatedAction {
  kind: ActionKind | string;
  category?: ActionCategory | string;
  params: Record<string, any>;
  risk?: RiskAssessment;
}
