import { createHash } from "node:crypto";
import {
  PolicyDecision,
  PolicyRule,
  PolicyVersion,
  PolicyVersionDiff,
} from "./types.js";
import { canonicalizeJson } from "../audit/hash.js";

export const MAX_POLICY_RULES = 500;
export const MAX_POLICY_BYTES = 500 * 1024; // 500 KB

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePolicy(
  rules: PolicyRule[],
  defaultDecision: PolicyDecision = "ALLOW",
  timeoutMs: number = 300000,
): PolicyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rules || !Array.isArray(rules)) {
    return { valid: false, errors: ["Rules must be an array"], warnings: [] };
  }

  if (rules.length === 0) {
    errors.push(
      "Policy rules array cannot be empty (fail closed: at least baseline rules required)",
    );
  }

  if (rules.length > MAX_POLICY_RULES) {
    errors.push(
      `Policy exceeds maximum rule limit of ${MAX_POLICY_RULES} (found ${rules.length})`,
    );
  }

  if (!["ALLOW", "DENY", "ASK"].includes(defaultDecision)) {
    errors.push(
      `Invalid default decision '${defaultDecision}': must be ALLOW, DENY, or ASK`,
    );
  }

  if (
    typeof timeoutMs !== "number" ||
    isNaN(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 86400000
  ) {
    errors.push(
      `Invalid timeoutMs '${timeoutMs}': must be between 1000ms and 86400000ms (24 hours)`,
    );
  }

  const seenIds = new Set<string>();
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (
      !rule ||
      !rule.id ||
      typeof rule.id !== "string" ||
      rule.id.trim().length === 0
    ) {
      errors.push(`Rule at index ${i} has empty or missing id`);
      continue;
    }

    if (seenIds.has(rule.id)) {
      errors.push(`Duplicate rule ID detected: '${rule.id}'`);
    }
    seenIds.add(rule.id);

    if (!["ALLOW", "DENY", "ASK"].includes(rule.decision)) {
      errors.push(
        `Rule '${rule.id}' has invalid decision '${rule.decision}': must be ALLOW, DENY, or ASK`,
      );
    }

    const hasMatcher = Boolean(
      rule.action || rule.path || rule.command || rule.when,
    );
    if (!hasMatcher) {
      errors.push(
        `Rule '${rule.id}' has no matcher criteria (must specify action, path, command, or when condition)`,
      );
    }

    if (
      rule.maxRiskScore !== undefined &&
      (typeof rule.maxRiskScore !== "number" ||
        isNaN(rule.maxRiskScore) ||
        rule.maxRiskScore < 0 ||
        rule.maxRiskScore > 100)
    ) {
      errors.push(
        `Rule '${rule.id}' has invalid maxRiskScore '${rule.maxRiskScore}': must be 0-100`,
      );
    }

    if (
      rule.path &&
      typeof rule.path === "string" &&
      rule.path.includes("\0")
    ) {
      errors.push(`Rule '${rule.id}' path contains illegal null bytes`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function computePolicyHash(
  rules: PolicyRule[],
  defaultDecision: PolicyDecision,
  timeoutMs: number,
): string {
  const normalized = {
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      action: r.action,
      path: r.path,
      command: r.command,
      decision: r.decision,
      enabled: r.enabled !== false,
      reason: r.reason,
      agentId: r.agentId,
      maxRiskScore: r.maxRiskScore,
      when: r.when,
    })),
    defaultDecision,
    timeoutMs,
  };
  return createHash("sha256")
    .update(canonicalizeJson(normalized))
    .digest("hex");
}

export function diffPolicyVersions(
  vA: PolicyVersion,
  vB: PolicyVersion,
): PolicyVersionDiff {
  const rulesMapA = new Map<string, PolicyRule>();
  for (const r of vA.rules) {
    rulesMapA.set(r.id, r);
  }

  const rulesMapB = new Map<string, PolicyRule>();
  for (const r of vB.rules) {
    rulesMapB.set(r.id, r);
  }

  const addedRules: PolicyRule[] = [];
  const removedRules: PolicyRule[] = [];
  const modifiedRules: PolicyVersionDiff["modifiedRules"] = [];

  // Identify added & modified rules
  for (const [id, ruleB] of rulesMapB.entries()) {
    if (!rulesMapA.has(id)) {
      addedRules.push(ruleB);
    } else {
      const ruleA = rulesMapA.get(id)!;
      const changes: string[] = [];

      if (ruleA.decision !== ruleB.decision) {
        changes.push(
          `decision changed from ${ruleA.decision} to ${ruleB.decision}`,
        );
      }
      if ((ruleA.enabled !== false) !== (ruleB.enabled !== false)) {
        changes.push(
          `enabled changed from ${ruleA.enabled !== false} to ${ruleB.enabled !== false}`,
        );
      }
      if (ruleA.action !== ruleB.action) {
        changes.push(`action changed from ${ruleA.action} to ${ruleB.action}`);
      }
      if (ruleA.path !== ruleB.path) {
        changes.push(`path changed from ${ruleA.path} to ${ruleB.path}`);
      }
      if (ruleA.command !== ruleB.command) {
        changes.push(
          `command changed from ${ruleA.command} to ${ruleB.command}`,
        );
      }
      if (ruleA.maxRiskScore !== ruleB.maxRiskScore) {
        changes.push(
          `maxRiskScore changed from ${ruleA.maxRiskScore} to ${ruleB.maxRiskScore}`,
        );
      }
      if (ruleA.reason !== ruleB.reason) {
        changes.push(
          `reason changed from '${ruleA.reason}' to '${ruleB.reason}'`,
        );
      }

      if (changes.length > 0) {
        modifiedRules.push({
          ruleId: id,
          before: ruleA,
          after: ruleB,
          changes,
        });
      }
    }
  }

  // Identify removed rules
  for (const [id, ruleA] of rulesMapA.entries()) {
    if (!rulesMapB.has(id)) {
      removedRules.push(ruleA);
    }
  }

  const diff: PolicyVersionDiff = {
    versionA: vA.versionNumber,
    versionB: vB.versionNumber,
    addedRules,
    removedRules,
    modifiedRules,
  };

  if (vA.defaultDecision !== vB.defaultDecision) {
    diff.defaultDecisionChanged = {
      before: vA.defaultDecision,
      after: vB.defaultDecision,
    };
  }

  return diff;
}
