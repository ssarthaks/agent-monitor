import { ActionCategory, ActionKind } from "../actions/types.js";
import { RiskAssessment } from "../risk/types.js";

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
}
