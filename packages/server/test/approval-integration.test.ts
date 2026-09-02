import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "better-sqlite3";
import { createDatabase } from "../src/db/database.js";
import { SessionRepository } from "../src/db/repository.js";
import { EventBus } from "../src/bus.js";
import { MonitorServer } from "../src/app.js";
import { ApprovalRequest, PolicyEngine, AgentEvent } from "@agent-monitor/core";

describe("Authoritative Approval Resolution & Race Safety (Fix 2 & Fix 3)", () => {
  let db: Database;
  let repo: SessionRepository;
  let bus: EventBus;
  let server: MonitorServer;
  let serverUrl: string;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    repo = new SessionRepository(db);
    bus = new EventBus();
    server = new MonitorServer({
      port: 0,
      repository: repo,
      eventBus: bus,
      policyEngine: new PolicyEngine(),
    });
    const { port } = await server.start();
    serverUrl = `http://127.0.0.1:${port}`;

    // Provider-independent session with custom agentId
    repo.createSession({
      id: "ses_custom_01",
      agentId: "test-agent",
      agentName: "Custom Agent",
      provider: "test-provider",
      model: "test-model",
      workspaceRoot: "/app",
      task: "Test single event emission and provider independence",
      startedAt: Date.now(),
      status: "running",
      riskScore: 0,
    });
  });

  afterEach(async () => {
    await server.stop();
    db.close();
  });

  it("emits EXACTLY ONE approval.resolved event with dynamic agentId (Fix 2 & Fix 3)", async () => {
    const approval: ApprovalRequest = {
      id: "app_single_01",
      actionId: "act_single_01",
      sessionId: "ses_custom_01",
      actionKind: "process.exec",
      category: "process",
      params: { command: "git push origin main" },
      risk: { score: 70, level: "HIGH", flags: [] },
      reason: "Git push requires human approval",
      matchedPolicies: ["ask-git-push"],
      status: "pending",
      createdAt: Date.now(),
    };
    repo.createApproval(approval);

    const res = await fetch(`${serverUrl}/approvals/app_single_01/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "user_browser" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.approval.status).toBe("approved");

    // Query SQLite events table
    const allEvents = repo.getEventsBySession("ses_custom_01");
    const resolvedEvents = allEvents.filter(
      (e) => e.type === "approval.resolved",
    );

    // STRICT GUARANTEE: EXACTLY ONE approval.resolved event
    expect(resolvedEvents.length).toBe(1);

    const singleEvent = resolvedEvents[0] as any;
    expect(singleEvent.approvalId).toBe("app_single_01");
    expect(singleEvent.decision).toBe("approved");
    expect(singleEvent.resolvedBy).toBe("user_browser");

    // Fix 3 verification: agentId dynamically derived from session ('test-agent', NOT 'deepseek-coding-agent')
    expect(singleEvent.agentId).toBe("test-agent");
  });

  it("approve vs deny race: exactly ONE resolution wins and exactly ONE event is created", async () => {
    const approval: ApprovalRequest = {
      id: "app_race_ad",
      actionId: "act_race_ad",
      sessionId: "ses_custom_01",
      actionKind: "process.exec",
      category: "process",
      params: { command: "git push origin main" },
      risk: { score: 70, level: "HIGH", flags: [] },
      reason: "Race test",
      matchedPolicies: ["ask-git-push"],
      status: "pending",
      createdAt: Date.now(),
    };
    repo.createApproval(approval);

    // Simultaneous concurrent requests
    const [resApprove, resDeny] = await Promise.all([
      fetch(`${serverUrl}/approvals/app_race_ad/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy: "browser_user" }),
      }),
      fetch(`${serverUrl}/approvals/app_race_ad/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy: "cli_user" }),
      }),
    ]);

    const statuses = [resApprove.status, resDeny.status].sort();
    expect(statuses).toEqual([200, 409]); // Exactly one 200 OK, exactly one 409 Conflict

    const allEvents = repo.getEventsBySession("ses_custom_01");
    const resolvedEvents = allEvents.filter(
      (e) => e.type === "approval.resolved",
    );

    // STRICT GUARANTEE: EXACTLY ONE approval.resolved event in database
    expect(resolvedEvents.length).toBe(1);
  });

  it("approve vs approve race: exactly ONE resolution wins and exactly ONE event is created", async () => {
    const approval: ApprovalRequest = {
      id: "app_race_aa",
      actionId: "act_race_aa",
      sessionId: "ses_custom_01",
      actionKind: "process.exec",
      category: "process",
      params: { command: "npm install express" },
      risk: { score: 40, level: "HIGH", flags: [] },
      reason: "Race test duplicate approve",
      matchedPolicies: ["ask-npm-install"],
      status: "pending",
      createdAt: Date.now(),
    };
    repo.createApproval(approval);

    const [res1, res2] = await Promise.all([
      fetch(`${serverUrl}/approvals/app_race_aa/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy: "user_1" }),
      }),
      fetch(`${serverUrl}/approvals/app_race_aa/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy: "user_2" }),
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const allEvents = repo.getEventsBySession("ses_custom_01");
    const resolvedEvents = allEvents.filter(
      (e) => e.type === "approval.resolved",
    );
    expect(resolvedEvents.length).toBe(1);
  });

  it("deny vs deny race: exactly ONE resolution wins and exactly ONE event is created", async () => {
    const approval: ApprovalRequest = {
      id: "app_race_dd",
      actionId: "act_race_dd",
      sessionId: "ses_custom_01",
      actionKind: "process.exec",
      category: "process",
      params: { command: "curl http://example.com" },
      risk: { score: 25, level: "MEDIUM", flags: [] },
      reason: "Race test duplicate deny",
      matchedPolicies: ["ask-outbound-curl"],
      status: "pending",
      createdAt: Date.now(),
    };
    repo.createApproval(approval);

    const [res1, res2] = await Promise.all([
      fetch(`${serverUrl}/approvals/app_race_dd/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy: "user_1" }),
      }),
      fetch(`${serverUrl}/approvals/app_race_dd/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy: "user_2" }),
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const allEvents = repo.getEventsBySession("ses_custom_01");
    const resolvedEvents = allEvents.filter(
      (e) => e.type === "approval.resolved",
    );
    expect(resolvedEvents.length).toBe(1);
  });
});
