import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { SessionRepository } from "../src/db/repository.js";
import { EventBus } from "../src/bus.js";
import { MonitorServer } from "../src/app.js";
import { AgentSession, ActionBlockedEvent } from "@agent-monitor/core";

describe("Security Incidents Model & Automatic Creation (Phase 3 & 4)", () => {
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
      id: "ses_inc_01",
      agentId: "agent_sec",
      agentName: "Security Test Agent",
      provider: "mock",
      model: "mock-model",
      workspaceRoot: "/test/workspace",
      task: "Security incident verification",
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

  it("creates and manages security incidents with immutable event links", () => {
    // Record an event in the session
    const evt: any = {
      id: "evt_trigger_1",
      sequence: 1,
      sessionId: "ses_inc_01",
      agentId: "agent_sec",
      timestamp: Date.now(),
      type: "action.blocked",
      actionId: "act_1",
      kind: "file.write",
      params: { path: "/etc/passwd" },
      reason: "Workspace boundary escape attempt outside workspace",
    };
    repo.insertEvent(evt);

    const incident = repo.createIncident({
      sessionId: "ses_inc_01",
      severity: "HIGH",
      triggerType: "WORKSPACE_ESCAPE",
      title: "Workspace Escape via /etc/passwd",
      description: "Attempted write to system file",
      triggerEventId: "evt_trigger_1",
      relatedEventIds: ["evt_trigger_1"],
    });

    expect(incident.id).toBeDefined();
    expect(incident.incidentNumber).toBe("INC-00001");
    expect(incident.status).toBe("OPEN");
    expect(incident.severity).toBe("HIGH");

    // Fetch related events for the incident
    const events = repo.getIncidentEvents(incident.id);
    expect(events.length).toBe(1);
    expect(events[0].id).toBe("evt_trigger_1");

    // Update status to CONTAINED, then RESOLVED
    const contained = repo.updateIncident(incident.id, {
      status: "CONTAINED",
    });
    expect(contained?.status).toBe("CONTAINED");

    const resolved = repo.updateIncident(incident.id, {
      status: "RESOLVED",
      resolvedBy: "secops_analyst",
      resolutionNotes: "Contained host and blocked tool",
    });
    expect(resolved?.status).toBe("RESOLVED");
    expect(resolved?.resolvedAt).toBeDefined();
    expect(resolved?.resolvedBy).toBe("secops_analyst");
  });

  it("automatically creates incidents for high-confidence security triggers", async () => {
    // 1. Post an action.blocked event with a private key leak
    const leakEvent: ActionBlockedEvent = {
      id: "evt_leak_1",
      sequence: 1,
      sessionId: "ses_inc_01",
      agentId: "agent_sec",
      timestamp: Date.now(),
      type: "action.blocked",
      actionId: "act_leak",
      kind: "file.read",
      category: "file",
      params: { path: "id_rsa" },
      reason: "Private key leak pattern detected in output",
      risk: { level: "CRITICAL", score: 95, flags: [] },
    };

    const res = await fetch(`${serverUrl}/sessions/ses_inc_01/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leakEvent),
    });
    expect(res.status).toBe(201);

    // Verify incident was automatically created
    const incidents = repo.listIncidents({ sessionId: "ses_inc_01" });
    expect(incidents.length).toBe(1);
    expect(incidents[0].triggerType).toBe("PRIVATE_KEY_LEAK");
    expect(incidents[0].severity).toBe("CRITICAL");
    expect(incidents[0].title).toContain("Private Key");
  });

  it("exposes incident lifecycle and filtering over REST API", async () => {
    // Create manual incident via API
    const resCreate = await fetch(`${serverUrl}/incidents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "ses_inc_01",
        severity: "MEDIUM",
        triggerType: "REPEATED_POLICY_DENIAL",
        title: "Repeated Denials",
        description: "Agent repeatedly probed blocked commands",
      }),
    });
    expect(resCreate.status).toBe(201);
    const dataCreate = await resCreate.json();
    const incId = dataCreate.incident.id;

    // PATCH /incidents/:id to update status
    const resUpdate = await fetch(`${serverUrl}/incidents/${incId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "INVESTIGATING",
        resolvedBy: "analyst_1",
      }),
    });
    expect(resUpdate.status).toBe(200);
    const dataUpdate = await resUpdate.json();
    expect(dataUpdate.incident.status).toBe("INVESTIGATING");

    // GET /incidents
    const resList = await fetch(`${serverUrl}/incidents?status=INVESTIGATING`);
    expect(resList.status).toBe(200);
    const dataList = await resList.json();
    expect(dataList.incidents.length).toBe(1);
    expect(dataList.incidents[0].id).toBe(incId);
  });
});
