export interface EventHashChain {
  id: string;
  sessionId: string;
  sequence: number;
  hash: string;
  prevHash: string | null;
}

export interface AuditVerificationResult {
  verified: boolean;
  totalEvents: number;
  lastSequence: number;
  lastHash: string | null;
  brokenAtSequence?: number;
  reason?: string;
}
