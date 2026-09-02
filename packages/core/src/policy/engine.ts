import fs from "node:fs";
import path from "node:path";
import {
  PolicyConfig,
  PolicyDecision,
  PolicyEvaluation,
  PolicyRule,
  PolicyActionContext,
  EvaluatedAction,
} from "./types.js";
import { DEFAULT_POLICY_RULES } from "./defaults.js";
import { calculateRuleSpecificity, matchesRule } from "./matcher.js";

const SAFETY_PREFERENCE_ORDER: Record<PolicyDecision, number> = {
  DENY: 3,
  ASK: 2,
  ALLOW: 1,
};

export class PolicyEngine {
  private config: PolicyConfig;
  private rules: Array<{
    rule: PolicyRule;
    specificity: number;
    order: number;
  }>;
  private defaultDecision: PolicyDecision;
  private timeoutMs: number;

  constructor(config?: PolicyConfig) {
    this.config = config || {};
    this.defaultDecision = this.config.policy?.default || "ALLOW";
    this.timeoutMs =
      this.config.approval?.timeoutMs ||
      this.config.policy?.timeoutMs ||
      300000;

    const userRules = this.config.rules || [];
    const combinedRules =
      userRules.length > 0
        ? [...userRules, ...DEFAULT_POLICY_RULES]
        : DEFAULT_POLICY_RULES;

    // Pre-calculate specificity and track declaration order for deterministic evaluation
    this.rules = combinedRules.map((rule, order) => ({
      rule,
      specificity: calculateRuleSpecificity(rule),
      order,
    }));
  }

  /**
   * Evaluates an agent action against all policies deterministically.
   *
   * Precedence algorithm:
   * 1. Specificity score (highest numerical score wins)
   * 2. Safety precedence (DENY > ASK > ALLOW)
   * 3. Rule declaration order (earlier declared in config wins)
   * 4. Default policy fallback
   */
  evaluate(
    action: EvaluatedAction,
    context: PolicyActionContext,
  ): PolicyEvaluation {
    const matching: Array<{
      rule: PolicyRule;
      specificity: number;
      order: number;
    }> = [];

    for (const item of this.rules) {
      if (matchesRule(item.rule, action, context)) {
        matching.push(item);
      }
    }

    if (matching.length === 0) {
      return {
        decision: this.defaultDecision,
        matchedPolicies: [],
        specificity: 0,
        reason: `No specific policy matched. Applied default decision: ${this.defaultDecision}.`,
      };
    }

    // Sort matching rules by precedence:
    matching.sort((a, b) => {
      // 1. Specificity (higher specificity wins)
      if (b.specificity !== a.specificity) {
        return b.specificity - a.specificity;
      }

      // 2. Safety Precedence (DENY > ASK > ALLOW)
      const safetyA = SAFETY_PREFERENCE_ORDER[a.rule.decision] || 0;
      const safetyB = SAFETY_PREFERENCE_ORDER[b.rule.decision] || 0;
      if (safetyB !== safetyA) {
        return safetyB - safetyA;
      }

      // 3. Declaration Order (earlier declared wins)
      return a.order - b.order;
    });

    const winner = matching[0];
    const matchedPolicies = matching.map((m) => m.rule.id);

    return {
      decision: winner.rule.decision,
      matchedPolicies,
      specificity: winner.specificity,
      reason:
        winner.rule.reason ||
        `Matched policy rule '${winner.rule.id}' with decision ${winner.rule.decision}.`,
      rule: winner.rule,
    };
  }

  getRules(): PolicyRule[] {
    return this.rules.map((r) => r.rule);
  }

  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  getDefaultDecision(): PolicyDecision {
    return this.defaultDecision;
  }

  /**
   * Validates a policy configuration object.
   */
  static validateConfig(raw: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!raw || typeof raw !== "object") {
      return {
        valid: false,
        errors: ["Configuration must be a valid JSON object"],
      };
    }

    if (
      raw.policy?.default &&
      !["ALLOW", "DENY", "ASK"].includes(raw.policy.default)
    ) {
      errors.push(
        `Invalid default policy decision '${raw.policy.default}'. Must be ALLOW, DENY, or ASK.`,
      );
    }

    if (raw.approval?.timeoutMs !== undefined) {
      if (
        typeof raw.approval.timeoutMs !== "number" ||
        raw.approval.timeoutMs <= 0
      ) {
        errors.push(
          "approval.timeoutMs must be a positive integer milliseconds",
        );
      }
    }

    if (raw.rules !== undefined) {
      if (!Array.isArray(raw.rules)) {
        errors.push('Property "rules" must be an array of policy rules');
      } else {
        raw.rules.forEach((rule: any, index: number) => {
          const ruleIdentifier = rule?.id || `rules[${index}]`;

          if (!rule || typeof rule !== "object") {
            errors.push(`Rule ${ruleIdentifier} must be an object`);
            return;
          }

          if (!rule.id || typeof rule.id !== "string") {
            errors.push(
              `Rule ${ruleIdentifier} is missing a required non-empty "id"`,
            );
          }

          if (
            !rule.decision ||
            !["ALLOW", "DENY", "ASK"].includes(rule.decision)
          ) {
            errors.push(
              `Rule ${ruleIdentifier} has invalid decision '${rule.decision}'. Must be ALLOW, DENY, or ASK.`,
            );
          }

          if (!rule.action && !rule.path && !rule.command) {
            errors.push(
              `Rule ${ruleIdentifier} must specify at least one of "action", "path", or "command"`,
            );
          }
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Loads and validates a policy configuration from file or returns defaults.
   */
  static loadFromFile(filePath: string): PolicyConfig {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      const validation = PolicyEngine.validateConfig(parsed);
      if (!validation.valid) {
        throw new Error(
          `Invalid policy configuration in '${filePath}':\n - ${validation.errors.join("\n - ")}`,
        );
      }
      return parsed as PolicyConfig;
    } catch (err: any) {
      throw new Error(`Failed to load policy configuration: ${err.message}`);
    }
  }
}
