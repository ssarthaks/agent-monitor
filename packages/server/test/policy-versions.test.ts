import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { SessionRepository } from "../src/db/repository.js";
import { EventBus } from "../src/bus.js";
import { MonitorServer } from "../src/app.js";
import { PolicyRule } from "@agent-monitor/core";

describe("Centralized Policy Management & Versioning (Phase 2)", () => {
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
  });

  afterEach(async () => {
    await server.stop();
    db.close();
  });

  it("creates initial baseline policy version on server bootstrap", () => {
    const active = repo.getActivePolicyVersion();
    expect(active).toBeDefined();
    expect(active?.versionNumber).toBe(1);
    expect(active?.isActive).toBe(true);
    expect(active?.rules.length).toBeGreaterThan(0);
    expect(active?.hash).toBeDefined();
  });

  it("supports creating new policy versions, version diffs, and atomic activation", async () => {
    const customRules: PolicyRule[] = [
      {
        id: "block-env",
        path: "**/.env*",
        decision: "DENY",
        reason: "Block environment credentials",
      },
      {
        id: "ask-curl",
        command: "curl *",
        decision: "ASK",
        reason: "Prompt for network curl calls",
      },
    ];

    const v2 = repo.createPolicyVersion({
      name: "Stricter Policy v2",
      description: "Added stricter network rules",
      rules: customRules,
      defaultDecision: "ASK",
      createdBy: "secops",
      changeSummary: "Added ask-curl and block-env",
      activate: true,
    });

    expect(v2.versionNumber).toBe(2);
    expect(v2.isActive).toBe(true);

    // Old v1 should now be inactive
    const v1 = repo.getPolicyVersion(1);
    expect(v1?.isActive).toBe(false);

    // Diff v1 and v2
    const diff = repo.diffPolicyVersions(1, 2);
    expect(diff.versionA).toBe(1);
    expect(diff.versionB).toBe(2);
    expect(diff.addedRules.some((r) => r.id === "ask-curl")).toBe(true);
    expect(diff.defaultDecisionChanged).toBeDefined();
    expect(diff.defaultDecisionChanged?.before).toBe("ALLOW");
    expect(diff.defaultDecisionChanged?.after).toBe("ASK");
  });

  it("safely and auditably rolls back to a previous policy version", async () => {
    const v1 = repo.getActivePolicyVersion()!;

    // Create v2
    repo.createPolicyVersion({
      name: "Temporary Lockdown v2",
      rules: [{ id: "deny-all", action: "*", decision: "DENY" }],
      defaultDecision: "DENY",
      createdBy: "admin",
      activate: true,
    });

    const activeV2 = repo.getActivePolicyVersion()!;
    expect(activeV2.versionNumber).toBe(2);

    // Rollback to v1 -> creates v3 cloning v1's rules
    const v3 = repo.rollbackPolicyVersion(1, "secops_lead");
    expect(v3.versionNumber).toBe(3);
    expect(v3.isActive).toBe(true);
    expect(v3.name).toContain("Rollback to v1");
    expect(v3.rules.length).toBe(v1.rules.length);
    expect(v3.defaultDecision).toBe(v1.defaultDecision);

    const audit = repo.getPolicyAuditLog();
    expect(audit.some((a) => a.action === "created")).toBe(true);
    expect(audit.some((a) => a.action === "activated")).toBe(true);
  });

  it("supports toggling individual policy rules", async () => {
    const active = repo.getActivePolicyVersion()!;
    const firstRuleId = active.rules[0].id;

    // Toggle rule off
    const toggledOff = repo.togglePolicyRule(firstRuleId, false, "admin");
    const disabledRule = toggledOff.rules.find((r) => r.id === firstRuleId);
    expect(disabledRule?.enabled).toBe(false);

    // Toggle rule back on
    const toggledOn = repo.togglePolicyRule(firstRuleId, true, "admin");
    const enabledRule = toggledOn.rules.find((r) => r.id === firstRuleId);
    expect(enabledRule?.enabled).toBe(true);
  });

  it("serves policy versions, diffs, and activations over REST API", async () => {
    // 1. GET /policy/versions
    const resList = await fetch(`${serverUrl}/policy/versions`);
    expect(resList.status).toBe(200);
    const dataList = await resList.json();
    expect(dataList.versions.length).toBeGreaterThanOrEqual(1);

    // 2. POST /policy/versions
    const resCreate = await fetch(`${serverUrl}/policy/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "API Created Version",
        rules: [
          {
            id: "api-rule-1",
            path: "**/*.pem",
            decision: "DENY",
            reason: "Block certs",
          },
        ],
        defaultDecision: "ALLOW",
        createdBy: "api-user",
        activate: true,
      }),
    });
    expect(resCreate.status).toBe(201);
    const dataCreate = await resCreate.json();
    expect(dataCreate.version.versionNumber).toBe(2);
    expect(dataCreate.version.isActive).toBe(true);

    // 3. GET /policy/versions/diff?vA=1&vB=2
    const resDiff = await fetch(`${serverUrl}/policy/versions/diff?vA=1&vB=2`);
    expect(resDiff.status).toBe(200);
    const dataDiff = await resDiff.json();
    expect(
      dataDiff.diff.addedRules.some((r: any) => r.id === "api-rule-1"),
    ).toBe(true);

    // 4. POST /policy/versions/1/activate
    const resActivate = await fetch(`${serverUrl}/policy/versions/1/activate`, {
      method: "POST",
    });
    expect(resActivate.status).toBe(200);
    const dataActivate = await resActivate.json();
    expect(dataActivate.version.versionNumber).toBe(1);
    expect(dataActivate.version.isActive).toBe(true);
  });
});
