import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { SessionRepository } from "../src/db/repository.js";
import { EventBus } from "../src/bus.js";
import { MonitorServer } from "../src/app.js";
import { calculateSessionRisk, AgentSession } from "@agent-monitor/core";

describe("Session Risk Scoring & Explainability (Phase 4)", () => {
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
      id: "ses_risk_01",
      agentId: "agent_risk",
      agentName: "Risk Test Agent",
      provider: "mock",
      model: "mock-model",
      workspaceRoot: "/test/workspace",
      task: "Session risk testing",
      startedAt: Date.now(),
      status: "running",
      riskScore: 0,
    };
    repo.createSession(session);
  });

  afterEach(async () => {
    await server.stop();
    db.close();
  });

  it("calculates deterministic and explainable score with contributors", () => {
    const events: any[] = [
      {
        id: "evt_1",
        sequence: 1,
        sessionId: "ses_risk_01",
        type: "action.blocked",
        kind: "file.write",
        reason: "Workspace boundary escape attempt outside workspace",
        timestamp: 1000,
      },
      {
        id: "evt_2",
        sequence: 2,
        sessionId: "ses_risk_01",
        type: "action.blocked",
        kind: "custom_tool",
        reason: "Execution blocked: mutated tool schema",
        timestamp: 2000,
      },
      {
        id: "evt_3",
        sequence: 3,
        sessionId: "ses_risk_01",
        type: "action.blocked",
        kind: "file.read",
        reason: "Private key leak pattern detected in output",
        timestamp: 3000,
      },
      {
        id: "evt_4",
        sequence: 4,
        sessionId: "ses_risk_01",
        type: "policy.evaluated",
        decision: "DENY",
        reason: "Policy violation: forbidden command",
        timestamp: 4000,
      },
    ];

    const breakdown = calculateSessionRisk("ses_risk_01", events);

    // Score calculation:
    // Workspace escape: +30
    // Mutated tool: +20
    // Private key: +25
    // Policy denial: +10
    // Total = 85
    expect(breakdown.score).toBe(85);
    expect(breakdown.severity).toBe("CRITICAL");
    expect(breakdown.contributors.length).toBe(4);

    const categories = breakdown.contributors.map((c) => c.category);
    expect(categories).toContain("WORKSPACE_ESCAPE");
    expect(categories).toContain("MUTATED_TOOL");
    expect(categories).toContain("SECRET_LEAK");
    expect(categories).toContain("POLICY_VIOLATION");
  });

  it("caps maximum score at 100 when multiple critical signals fire", () => {
    const events: any[] = [
      {
        id: "evt_1",
        sequence: 1,
        sessionId: "ses_risk_01",
        type: "action.blocked",
        kind: "file.write",
        reason: "outside workspace",
        timestamp: 1000,
      },
      {
        id: "evt_2",
        sequence: 2,
        sessionId: "ses_risk_01",
        type: "control.kill_switch_enabled",
        reason: "Emergency kill",
        timestamp: 2000,
      },
      {
        id: "evt_3",
        sequence: 3,
        sessionId: "ses_risk_01",
        type: "behavioral.match",
        match: { severity: "CRITICAL", name: "Exfiltration" },
        timestamp: 3000,
      },
    ];

    const breakdown = calculateSessionRisk("ses_risk_01", events);
    // 30 (workspace) + 50 (kill switch) + 40 (behavioral) = 120 -> capped at 100
    expect(breakdown.score).toBe(100);
    expect(breakdown.severity).toBe("CRITICAL");
  });

  it("serves session risk breakdown over REST API", async () => {
    // Insert test events into database
    repo.insertEvent({
      id: "evt_api_1",
      sequence: 1,
      sessionId: "ses_risk_01",
      agentId: "agent_risk",
      timestamp: Date.now(),
      type: "action.blocked",
      actionId: "act_1",
      kind: "file.write",
      category: "file",
      params: { path: "../outside" },
      reason: "Workspace boundary violation: outside workspace",
      risk: { level: "HIGH", score: 80, flags: [] },
    });

    const res = await fetch(`${serverUrl}/sessions/ses_risk_01/risk-breakdown`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.breakdown.sessionId).toBe("ses_risk_01");
    expect(data.breakdown.score).toBeGreaterThanOrEqual(30);
    expect(data.breakdown.contributors.length).toBeGreaterThanOrEqual(1);
    expect(data.breakdown.contributors[0].category).toBe("WORKSPACE_ESCAPE");
  });
});
