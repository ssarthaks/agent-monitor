export type PolicyDecision = 'ALLOW' | 'DENY' | 'ASK';

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  reason?: string;
  matchedRuleId?: string;
}
