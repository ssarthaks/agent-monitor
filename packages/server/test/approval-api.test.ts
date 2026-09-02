import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "better-sqlite3";
import { createDatabase } from "../src/db/database.js";
import { SessionRepository } from "../src/db/repository.js";
import { EventBus } from "../src/bus.js";
import { MonitorServer } from "../src/app.js";
import { ApprovalRequest, PolicyEngine } from "@agent-monitor/core";

describe("Server REST APIs for Approvals & Policy (Phase D)", () => {
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

    repo.createSession({
      id: "ses_api_01",
      agentId: "deepseek-agent",
      agentName: "DeepSeek Coding Agent",
      provider: "deepseek",
      model: "deepseek-chat",
      workspaceRoot: "/app",
      task: "Test approvals API",
      startedAt: Date.now(),
      status: "running",
      riskScore: 0,
    });
  });

  afterEach(async () => {
    await server.stop();
    db.close();
  });

  it("GET /policy returns active policy rules and defaults", async () => {
    const res = await fetch(`${serverUrl}/policy`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.default).toBe("ALLOW");
    expect(data.rules.length).toBeGreaterThan(5);
  });

  it("POST /policy/evaluate performs dry-run evaluation without executing action", async () => {
    const res = await fetch(`${serverUrl}/policy/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: {
          kind: "process.exec",
          params: { command: "git push origin main" },
        },
        context: { workspaceRoot: "/app" },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.evaluation.decision).toBe("ASK");
    expect(data.evaluation.matchedPolicies).toContain("ask-git-push");
  });

  it("handles approval lifecycle and atomic conflict resolution over HTTP", async () => {
    const approval: ApprovalRequest = {
      id: "app_http_01",
      actionId: "act_http_01",
      sessionId: "ses_api_01",
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

    // 1. GET /approvals/:id
    const resGet = await fetch(`${serverUrl}/approvals/app_http_01`);
    expect(resGet.status).toBe(200);
    const getData = await resGet.json();
    expect(getData.approval.status).toBe("pending");

    // 2. POST /approvals/:id/approve
    const resApprove = await fetch(
      `${serverUrl}/approvals/app_http_01/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolvedBy: "user_browser" }),
      },
    );
    expect(resApprove.status).toBe(200);
    const approveData = await resApprove.json();
    expect(approveData.success).toBe(true);
    expect(approveData.approval.status).toBe("approved");

    // 3. Duplicate POST /approvals/:id/deny -> 409 Conflict
    const resConflict = await fetch(`${serverUrl}/approvals/app_http_01/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "user_cli" }),
    });
    expect(resConflict.status).toBe(409);
    const conflictData = await resConflict.json();
    expect(conflictData.approval.status).toBe("approved"); // Remains approved
  });

  it("GET /sessions/:id/approvals lists session approvals", async () => {
    repo.createApproval({
      id: "app_list_01",
      actionId: "act_list_01",
      sessionId: "ses_api_01",
      actionKind: "process.exec",
      category: "process",
      params: { command: "npm install express" },
      risk: { score: 40, level: "HIGH", flags: [] },
      reason: "Dependencies approval",
      matchedPolicies: ["ask-npm-install"],
      status: "pending",
      createdAt: Date.now(),
    });

    const res = await fetch(`${serverUrl}/sessions/ses_api_01/approvals`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.approvals.length).toBe(1);
    expect(data.approvals[0].id).toBe("app_list_01");
  });
});
