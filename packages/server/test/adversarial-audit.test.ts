import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { SessionRepository } from "../src/db/repository.js";
import {
  verifyEventChain,
  exportCanonicalLedger,
  canonicalizeJson,
} from "@agent-monitor/core";

describe("Adversarial Audit Integrity & Tamper Resistance Tests", () => {
  let db: any;
  let repo: SessionRepository;
  const sessionId = "ses_adv_audit";

  beforeEach(() => {
    db = createDatabase(":memory:");
    repo = new SessionRepository(db);

    repo.createSession({
      id: sessionId,
      agentId: "agent_audit",
      agentName: "Audit Test Agent",
      provider: "mock",
      model: "mock-model",
      workspaceRoot: "/test/workspace",
      task: "Adversarial audit testing",
      startedAt: 1000,
      status: "running",
      riskScore: 0,
    });
  });

  afterEach(() => {
    db.close();
  });

  const insertChain = (count: number) => {
    for (let i = 1; i <= count; i++) {
      repo.insertEvent({
        id: `evt_${i}`,
        sequence: i,
        sessionId,
        agentId: "agent_audit",
        timestamp: 1000 + i * 10,
        type: i === 1 ? "session.started" : "agent.message",
        content: `Legit event ${i}`,
      } as any);
    }
    return repo.getEventsBySession(sessionId, 0);
  };

  it("detects sequence gap in event chain (missing intermediate event)", () => {
    const events = insertChain(4);
    // Remove event 3 (leaving 1, 2, 4)
    const gapped = [events[0], events[1], events[3]];
    const res = verifyEventChain(gapped as any);

    expect(res.verified).toBe(false);
    expect(res.brokenAtSequence).toBe(4);
    expect(res.reason).toMatch(
      /Sequence monotonicity violation.*expected sequence 3, found 4/,
    );
  });

  it("detects duplicate sequence numbers", () => {
    const events = insertChain(3);
    // Duplicate event 2
    const duplicated = [events[0], events[1], { ...events[1], id: "evt_dup" }];
    const res = verifyEventChain(duplicated as any);

    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(
      /Sequence monotonicity violation|Duplicate sequence number/,
    );
  });

  it("detects genesis sequence violation when chain does not start at sequence 1", () => {
    const events = insertChain(3);
    const nonGenesis = events.slice(1); // starts at sequence 2
    const res = verifyEventChain(nonGenesis as any);

    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(
      /Genesis violation: First event sequence must be 1/,
    );
  });

  it("detects genesis prevHash violation when first event specifies a prevHash", () => {
    const events = insertChain(2);
    const forgedGenesis = [
      { ...events[0], prevHash: "0123456789abcdef" },
      events[1],
    ];
    const res = verifyEventChain(forgedGenesis as any);

    expect(res.verified).toBe(false);
    expect(res.reason).toMatch(
      /Genesis violation: First event must have null prevHash/,
    );
  });

  it("detects forged prevHash linking", () => {
    const events = insertChain(3);
    // Tamper prevHash of event 2
    const tampered = [
      events[0],
      {
        ...events[1],
        prevHash:
          "bad0000000000000000000000000000000000000000000000000000000000000",
      },
      events[2],
    ];
    const res = verifyEventChain(tampered as any);

    expect(res.verified).toBe(false);
    expect(res.brokenAtSequence).toBe(2);
    expect(res.reason).toMatch(/prevHash mismatch/);
  });

  it("detects payload modification in database even when hash is preserved", () => {
    insertChain(3);
    // Maliciously modify the payload directly in SQLite
    const row = db
      .prepare("SELECT payload_json FROM events WHERE sequence = 2")
      .get() as any;
    const parsed = JSON.parse(row.payload_json);
    parsed.content = "Attacker hijacked message";
    db.prepare("UPDATE events SET payload_json = ? WHERE sequence = 2").run(
      JSON.stringify(parsed),
    );

    const events = repo.getEventsBySession(sessionId, 0);
    const res = verifyEventChain(events as any);

    expect(res.verified).toBe(false);
    expect(res.brokenAtSequence).toBe(2);
    expect(res.reason).toMatch(/Hash integrity violation/);
  });

  it("canonicalizeJson produces strictly deterministic key order regardless of insertion order", () => {
    const objA = { z: 1, a: "hello", m: [3, 2, 1], b: { y: true, x: false } };
    const objB = { a: "hello", b: { x: false, y: true }, m: [3, 2, 1], z: 1 };

    expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
    expect(canonicalizeJson(objA)).toBe(
      '{"a":"hello","b":{"x":false,"y":true},"m":[3,2,1],"z":1}',
    );
  });

  it("exports canonical ledger and confirms full verification", () => {
    const events = insertChain(3);
    const exportedJson = exportCanonicalLedger(events as any, {
      exportedAt: 1234567890,
    });
    expect(typeof exportedJson).toBe("string");

    const parsed = JSON.parse(exportedJson);
    expect(parsed.version).toBe("4.1.0");
    expect(parsed.totalEvents).toBe(3);
    expect(parsed.verification.verified).toBe(true);
    expect(parsed.events.length).toBe(3);
    expect(parsed.events[0].sequence).toBe(1);
  });

  it("redacts credentials before SQLite persistence and hashes the redacted payload", () => {
    const rawSecret = "ghp_1234567890abcdefghijklmnopqrstuvwxyzAB";
    repo.insertEvent({
      id: "evt_secret_test",
      sessionId,
      agentId: "agent_audit",
      timestamp: 2000,
      type: "agent.message",
      content: `Here is the token: ${rawSecret}`,
      metadata: {
        token: rawSecret,
        nested: {
          awsKey: "AKIAIOSFODNN7EXAMPLE",
        },
      },
    } as any);

    // Read directly from raw SQLite row
    const row = db
      .prepare("SELECT payload_json FROM events WHERE id = ?")
      .get("evt_secret_test") as any;
    expect(row).toBeDefined();
    expect(row.payload_json).not.toContain(rawSecret);
    expect(row.payload_json).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(row.payload_json).toContain("[REDACTED:GITHUB_TOKEN]");
    expect(row.payload_json).toContain("[REDACTED:AWS_ACCESS_KEY]");

    // Verify event chain integrity passes with the persisted sanitized payload
    const allEvents = repo.getEventsBySession(sessionId, 0);
    const verifyRes = verifyEventChain(allEvents as any);
    expect(verifyRes.verified).toBe(true);
  });

  it("canary test: proves raw secret bytes are physically absent from SQLite, audit hashes, and canonical export", () => {
    const canaryGithub = "ghp_CANARY9876543210abcdefghijklmnop";
    const canaryAws = "AKIAIOSFODNN7CANARY1";
    const canaryOpenAI = "sk-CANARY1234567890abcdef1234567890abcdef";

    const nestedPayload = {
      a: canaryGithub,
      nested: {
        b: [canaryAws, "safe-string"],
        c: {
          d: canaryOpenAI,
          e: `Text containing token: ${canaryGithub}`,
        },
      },
    };

    repo.insertEvent({
      id: "evt_canary_test",
      sessionId,
      agentId: "agent_audit",
      timestamp: 3000,
      type: "agent.message",
      content: `Message containing ${canaryGithub}`,
      metadata: nestedPayload,
    } as any);

    // 1. Raw SQLite row check: ensure raw canary bytes never hit the disk
    const row = db
      .prepare("SELECT payload_json FROM events WHERE id = ?")
      .get("evt_canary_test") as any;
    expect(row).toBeDefined();
    expect(row.payload_json).not.toContain(canaryGithub);
    expect(row.payload_json).not.toContain(canaryAws);
    expect(row.payload_json).not.toContain(canaryOpenAI);

    // 2. Repository retrieval channel check
    const retrievedEvents = repo.getEventsBySession(sessionId, 0);
    const serializedRetrieved = JSON.stringify(retrievedEvents);
    expect(serializedRetrieved).not.toContain(canaryGithub);
    expect(serializedRetrieved).not.toContain(canaryAws);
    expect(serializedRetrieved).not.toContain(canaryOpenAI);

    // 3. Export ledger channel check
    const exportedLedger = exportCanonicalLedger(retrievedEvents as any);
    expect(exportedLedger).not.toContain(canaryGithub);
    expect(exportedLedger).not.toContain(canaryAws);
    expect(exportedLedger).not.toContain(canaryOpenAI);

    // 4. Hash verification passes on sanitized ledger
    const verifyRes = verifyEventChain(retrievedEvents as any);
    expect(verifyRes.verified).toBe(true);
  });
});
