import { createHash } from "node:crypto";
import { ActionCategory, ActionKind } from "../actions/types.js";
import { RiskAssessment } from "../risk/types.js";
import { canonicalizeJson } from "../audit/hash.js";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRequest {
  id: string;
  actionId: string;
  sessionId: string;
  actionKind: ActionKind;
  category: ActionCategory;
  params: Record<string, any>;
  risk: RiskAssessment;
  reason: string;
  matchedPolicies: string[];
  status: ApprovalStatus;
  resolvedBy?: string | null;
  createdAt: number;
  resolvedAt?: number | null;
  policyVersion?: number;
  expiresAt?: number;
  actionContextHash?: string;
}

export interface ActionContextInput {
  sessionId: string;
  actionKind: string;
  params: Record<string, any>;
  source?: string;
  policyVersion?: number;
  riskScore?: number;
}

/**
 * Computes a deterministic SHA-256 hash of the canonical action context.
 * Binds an approval request cryptographically to the exact action parameters,
 * session, source, policy version, and risk state to prevent substitution or replay.
 */
export function computeActionContextHash(context: ActionContextInput): string {
  const canonical = canonicalizeJson({
    sessionId: context.sessionId,
    actionKind: context.actionKind,
    params: context.params,
    source: context.source || "default",
    policyVersion: context.policyVersion ?? 1,
    riskScore: context.riskScore ?? 0,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
