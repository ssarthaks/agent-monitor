export type RiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskFlag {
  ruleId: string;
  description: string;
  severity: RiskLevel;
  scoreImpact: number;
}

export interface RiskAssessment {
  score: number; // 0 to 100
  level: RiskLevel;
  flags: RiskFlag[];
}

export interface RiskRule {
  id: string;
  description: string;
  severity: RiskLevel;
  scoreImpact: number;
  matches: (kind: string, params: Record<string, any>, context?: { isOutsideWorkspace?: boolean }) => boolean;
}
