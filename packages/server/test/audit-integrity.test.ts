import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { SessionRepository } from "../src/db/repository.js";
import { EventBus } from "../src/bus.js";
import { MonitorServer } from "../src/app.js";
import { verifyEventChain, AgentSession } from "@agent-monitor/core";

describe("Audit Log Integrity & Hash Chaining (Phase 9)", () => {
  let db: any;
  let repo: SessionRepository;
  let eventBus: EventBus;
  let server: MonitorServer;
  let serverUrl: string;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    repo = new SessionRepository(db);
    eventBus = new EventBus();
    server = new MonitorServer({
      port: 0,
      host: "127.0.0.1",
      repository: repo,
      eventBus,
    });
    const info = await server.start();
    serverUrl = `http://${info.host}:${info.port}`;

    const session: AgentSession = {
      id: "ses_audit_01",
      agentId: "agent_audit",
      agentName: "Audit Test Agent",
      provider: "mock",
      model: "mock-model",
      workspaceRoot: "/test/workspace",
      task: "Audit verification",
      startedAt: 1000,
      status: "running",
      riskScore: 0,
    };
    repo.createSession(session);
  });

  afterEach(async () => {
    await server.stop();
    db.close();
  });

  it("automatically computes cryptographic hash chains for consecutive events", () => {
    for (let i = 1; i <= 5; i++) {
      repo.insertEvent({
        id: `evt_audit_${i}`,
        sequence: i,
        sessionId: "ses_audit_01",
        agentId: "agent_audit",
        timestamp: 1000 + i * 10,
        type: i === 1 ? "session.started" : "agent.message",
        content: `Message ${i}`,
      } as any);
    }

    const events = repo.getEventsBySession("ses_audit_01", 0);
    expect(events.length).toBe(5);

    // Sequence 1 must have prevHash null
    expect(events[0].prevHash).toBeNull();
    expect(events[0].hash).toBeDefined();

    // Sequence 2..5 must have prevHash equal to previous event's hash
    for (let i = 1; i < events.length; i++) {
      expect(events[i].prevHash).toBe(events[i - 1].hash);
      expect(events[i].hash).toBeDefined();
      expect(events[i].hash).not.toBe(events[i - 1].hash);
    }

    const verification = verifyEventChain(events as any);
    expect(verification.verified).toBe(true);
    expect(verification.totalEvents).toBe(5);
    expect(verification.lastSequence).toBe(5);
  });

  it("detects tampering when an event is maliciously modified in SQLite", () => {
    for (let i = 1; i <= 3; i++) {
      repo.insertEvent({
        id: `evt_tamper_${i}`,
        sequence: i,
        sessionId: "ses_audit_01",
        agentId: "agent_audit",
        timestamp: 1000 + i * 10,
        type: "agent.message",
        content: `Legitimate content ${i}`,
      } as any);
    }

    // Maliciously tamper with event 2 in the database directly
    const row2 = db
      .prepare(`SELECT payload_json FROM events WHERE id = 'evt_tamper_2'`)
      .get() as any;
    const parsed = JSON.parse(row2.payload_json);
    parsed.content = "TAMPERED EXFILTRATED SECRET CONTENT";
    db.prepare(
      `UPDATE events SET payload_json = ? WHERE id = 'evt_tamper_2'`,
    ).run(JSON.stringify(parsed));

    const events = repo.getEventsBySession("ses_audit_01", 0);
    const verification = verifyEventChain(events as any);

    expect(verification.verified).toBe(false);
    expect(verification.brokenAtSequence).toBe(2);
    expect(verification.reason).toContain(
      "Hash integrity violation at sequence 2",
    );
  });

  it("serves audit verification over REST API", async () => {
    repo.insertEvent({
      id: "evt_api_1",
      sequence: 1,
      sessionId: "ses_audit_01",
      agentId: "agent_audit",
      timestamp: 1000,
      type: "session.started",
    } as any);

    const res = await fetch(`${serverUrl}/audit/verify?sessionId=ses_audit_01`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verification.verified).toBe(true);
    expect(data.verification.totalEvents).toBe(1);
  });
});
