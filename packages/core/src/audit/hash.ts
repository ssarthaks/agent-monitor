import { createHash } from "node:crypto";
import { AuditVerificationResult } from "./types.js";

/**
 * Recursively canonicalizes any JavaScript object, array, or primitive
 * into a strictly deterministic JSON string.
 *
 * Guarantees:
 * 1. Object keys are sorted alphabetically at all nesting levels.
 * 2. Array element order is strictly preserved.
 * 3. Primitives and null/undefined are formatted deterministically.
 * 4. Zero dependency on object key insertion order.
 */
export function canonicalizeJson(val: any): string {
  if (val === null || val === undefined) {
    return "null";
  }
  if (typeof val !== "object") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  const keys = Object.keys(val).sort();
  const pairs: string[] = [];
  for (const key of keys) {
    const item = val[key];
    if (item !== undefined && typeof item !== "function") {
      pairs.push(`${JSON.stringify(key)}:${canonicalizeJson(item)}`);
    }
  }
  return `{${pairs.join(",")}}`;
}

export function computeEventHash(
  eventPayload: Record<string, any>,
  prevHash: string | null,
): string {
  const { hash: _h, prevHash: _ph, ...cleanPayload } = eventPayload;
  const canonicalPayload = canonicalizeJson(cleanPayload);
  const input = `${canonicalPayload}|${prevHash || "GENESIS"}`;
  return createHash("sha256").update(input).digest("hex");
}

export function verifyEventChain(
  events: Array<Record<string, any>>,
): AuditVerificationResult {
  if (events.length === 0) {
    return {
      verified: true,
      totalEvents: 0,
      lastSequence: 0,
      lastHash: null,
    };
  }

  let expectedPrevHash: string | null = null;
  const seenSequences = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const seq = event.sequence;
    const actualHash = event.hash;
    const actualPrevHash = event.prevHash ?? null;
    const expectedSeq = i + 1;

    // Strict Genesis Semantics (Sequence 1)
    if (i === 0) {
      if (seq !== 1) {
        return {
          verified: false,
          totalEvents: events.length,
          lastSequence: seq ?? 0,
          lastHash: actualHash ?? null,
          brokenAtSequence: seq ?? 0,
          reason: `Genesis violation: First event sequence must be 1, found ${seq}`,
        };
      }
      if (actualPrevHash !== null) {
        return {
          verified: false,
          totalEvents: events.length,
          lastSequence: seq,
          lastHash: actualHash ?? null,
          brokenAtSequence: seq,
          reason: `Genesis violation: First event must have null prevHash, found '${actualPrevHash}'`,
        };
      }
    } else {
      // Strict Sequence Monotonicity: exactly sequential, no duplicate, no gaps
      if (seq !== expectedSeq) {
        return {
          verified: false,
          totalEvents: events.length,
          lastSequence: seq ?? 0,
          lastHash: actualHash ?? null,
          brokenAtSequence: seq ?? expectedSeq,
          reason: `Sequence monotonicity violation at index ${i}: expected sequence ${expectedSeq}, found ${seq}`,
        };
      }
    }

    if (seenSequences.has(seq)) {
      return {
        verified: false,
        totalEvents: events.length,
        lastSequence: seq,
        lastHash: actualHash ?? null,
        brokenAtSequence: seq,
        reason: `Duplicate sequence number detected: ${seq}`,
      };
    }
    seenSequences.add(seq);

    if (!actualHash) {
      return {
        verified: false,
        totalEvents: events.length,
        lastSequence: seq,
        lastHash: null,
        brokenAtSequence: seq,
        reason: `Missing hash at sequence ${seq}`,
      };
    }

    if (actualPrevHash !== expectedPrevHash) {
      return {
        verified: false,
        totalEvents: events.length,
        lastSequence: seq,
        lastHash: actualHash,
        brokenAtSequence: seq,
        reason: `prevHash mismatch at sequence ${seq}: expected ${expectedPrevHash ?? "null"}, found ${actualPrevHash ?? "null"}`,
      };
    }

    const calculatedHash = computeEventHash(event, actualPrevHash);
    if (calculatedHash !== actualHash) {
      return {
        verified: false,
        totalEvents: events.length,
        lastSequence: seq,
        lastHash: actualHash,
        brokenAtSequence: seq,
        reason: `Hash integrity violation at sequence ${seq}: recomputed hash ${calculatedHash} does not match recorded hash ${actualHash}`,
      };
    }

    expectedPrevHash = actualHash;
  }

  return {
    verified: true,
    totalEvents: events.length,
    lastSequence: events[events.length - 1].sequence ?? events.length,
    lastHash: expectedPrevHash,
  };
}

/**
 * Generates a deterministic, canonical JSON export of an event chain.
 */
export function exportCanonicalLedger(
  events: Array<Record<string, any>>,
  metadata: Record<string, any> = {},
): string {
  const canonicalEvents = events.map((e) => {
    const { hash, prevHash, ...rest } = e;
    return {
      sequence: e.sequence,
      sessionId: e.sessionId,
      type: e.type,
      timestamp: e.timestamp,
      prevHash: prevHash ?? null,
      hash,
      payload: rest,
    };
  });

  const exportDoc = {
    version: "4.1.0",
    exportedAt: metadata.exportedAt || Date.now(),
    totalEvents: events.length,
    verification: verifyEventChain(events),
    events: canonicalEvents,
  };

  return canonicalizeJson(exportDoc);
}
