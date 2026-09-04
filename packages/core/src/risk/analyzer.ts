import { DETERMINISTIC_RISK_RULES } from './rules.js';
import { RiskAssessment, RiskFlag, RiskLevel, RiskRule } from './types.js';

export class RiskAnalyzer {
  private rules: RiskRule[];

  constructor(customRules: RiskRule[] = DETERMINISTIC_RISK_RULES) {
    this.rules = customRules;
  }

  analyze(
    kind: string,
    params: Record<string, any>,
    context?: { isOutsideWorkspace?: boolean }
    context?: { isOutsideWorkspace?: boolean; isToolMutated?: boolean }
  ): RiskAssessment {
    const flags: RiskFlag[] = [];
    let totalScore = 0;

    for (const rule of this.rules) {
      if (rule.matches(kind, params, context)) {
        flags.push({
          ruleId: rule.id,
          description: rule.description,
          severity: rule.severity,
          scoreImpact: rule.scoreImpact,
        });
        totalScore += rule.scoreImpact;
      }
    }

    const clampedScore = Math.min(100, Math.max(0, totalScore));
    const level = this.calculateLevel(clampedScore, flags);

    return {
      score: clampedScore,
      level,
      flags,
    };
  }

  private calculateLevel(score: number, flags: RiskFlag[]): RiskLevel {
    if (flags.some((f) => f.severity === 'CRITICAL') || score >= 60) {
      return 'CRITICAL';
    }
    if (flags.some((f) => f.severity === 'HIGH') || score >= 40) {
      return 'HIGH';
    }
    if (flags.some((f) => f.severity === 'MEDIUM') || score >= 20) {
      return 'MEDIUM';
    }
    if (score > 0) {
      return 'LOW';
    }
    return 'NONE';
  }
}
