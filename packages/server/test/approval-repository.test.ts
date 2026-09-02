import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "better-sqlite3";
import { createDatabase } from "../src/db/database.js";
import { SessionRepository } from "../src/db/repository.js";
import { ApprovalRequest } from "@agent-monitor/core";

describe("Approval Persistence & Atomic Resolution (Phase B)", () => {
  let db: Database;
  let repo: SessionRepository;

  beforeEach(() => {
    db = createDatabase(":memory:");
    repo = new SessionRepository(db);

    // Create prerequisite session
    repo.createSession({
      id: "ses_test_01",
      agentId: "agent_test",
      agentName: "Test Agent",
      provider: "test",
      model: "test-model",
      workspaceRoot: "/app",
      task: "Testing approvals",
      startedAt: Date.now(),
      status: "running",
      riskScore: 0,
    });
  });

  afterEach(() => {
    db.close();
  });

  it("creates and retrieves pending approval requests", () => {
    const approval: ApprovalRequest = {
      id: "app_01",
      actionId: "act_01",
      sessionId: "ses_test_01",
      actionKind: "process.exec",
      category: "process",
      params: { command: "git push origin main" },
      risk: { score: 72, level: "HIGH", flags: [] },
      reason: "Remote repository modification requires human approval.",
      matchedPolicies: ["ask-git-push"],
      status: "pending",
      createdAt: Date.now(),
    };

    repo.createApproval(approval);

    const retrieved = repo.getApproval("app_01");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("app_01");
    expect(retrieved?.status).toBe("pending");
    expect(retrieved?.params.command).toBe("git push origin main");
    expect(retrieved?.risk.score).toBe(72);
  });

  it("atomically resolves pending approval (first winner takes all)", () => {
    const approval: ApprovalRequest = {
      id: "app_race_01",
      actionId: "act_race_01",
      sessionId: "ses_test_01",
      actionKind: "process.exec",
      category: "process",
      params: { command: "git push origin main" },
      risk: { score: 72, level: "HIGH", flags: [] },
      reason: "Approval required",
      matchedPolicies: ["ask-git-push"],
      status: "pending",
      createdAt: Date.now(),
    };

    repo.createApproval(approval);

    // 1. Browser resolves 'approved'
    const res1 = repo.resolveApproval(
      "app_race_01",
      "approved",
      "user_browser",
    );
    expect(res1.success).toBe(true);
    expect(res1.approval?.status).toBe("approved");
    expect(res1.approval?.resolvedBy).toBe("user_browser");

    // 2. Simultaneous CLI attempts to resolve 'denied' on the same request
    const res2 = repo.resolveApproval("app_race_01", "denied", "user_cli");
    expect(res2.success).toBe(false); // Rejected! Already resolved
    expect(res2.approval?.status).toBe("approved"); // Remains approved
  });

  it("rejects duplicate resolution attempts on already resolved approvals", () => {
    const approval: ApprovalRequest = {
      id: "app_dup_01",
      actionId: "act_dup_01",
      sessionId: "ses_test_01",
      actionKind: "process.exec",
      category: "process",
      params: { command: "npm install express" },
      risk: { score: 40, level: "HIGH", flags: [] },
      reason: "Install requires approval",
      matchedPolicies: ["ask-npm-install"],
      status: "pending",
      createdAt: Date.now(),
    };

    repo.createApproval(approval);

    const first = repo.resolveApproval("app_dup_01", "denied", "user_browser");
    expect(first.success).toBe(true);

    const duplicate = repo.resolveApproval(
      "app_dup_01",
      "approved",
      "user_browser",
    );
    expect(duplicate.success).toBe(false);
    expect(duplicate.approval?.status).toBe("denied");
  });

  it("expires pending approvals that exceed maximum age timeout", () => {
    const oldTimestamp = Date.now() - 400000; // 400s ago (exceeds 300s)

    repo.createApproval({
      id: "app_expired_01",
      actionId: "act_expired_01",
      sessionId: "ses_test_01",
      actionKind: "process.exec",
      category: "process",
      params: { command: "git push" },
      risk: { score: 50, level: "HIGH", flags: [] },
      reason: "Old request",
      matchedPolicies: ["ask-git-push"],
      status: "pending",
      createdAt: oldTimestamp,
    });

    const expiredList = repo.expirePendingApprovals(300000);
    expect(expiredList.length).toBe(1);
    expect(expiredList[0].id).toBe("app_expired_01");
    expect(expiredList[0].status).toBe("expired");

    const updated = repo.getApproval("app_expired_01");
    expect(updated?.status).toBe("expired");
  });

  it("persists pending approvals across database reconnection", () => {
    repo.createApproval({
      id: "app_persist_01",
      actionId: "act_persist_01",
      sessionId: "ses_test_01",
      actionKind: "file.read",
      category: "filesystem",
      params: { path: "secret.txt" },
      risk: { score: 30, level: "MEDIUM", flags: [] },
      reason: "Custom ask",
      matchedPolicies: ["custom-ask"],
      status: "pending",
      createdAt: Date.now(),
    });

    // Create a second repository instance on the same database
    const repo2 = new SessionRepository(db);
    const retrieved = repo2.getApproval("app_persist_01");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.status).toBe("pending");
  });
});
