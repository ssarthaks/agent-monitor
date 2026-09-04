import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createDatabase, SessionRepository } from "@agent-monitor/server";
import {
  runPolicyVersionsCommand,
  runPolicyRollbackCommand,
  runPolicyToggleRuleCommand,
  runPolicyDiffCommand,
  runPolicyHistoryCommand,
} from "../src/commands/policy-v4.js";
import {
  runIncidentsListCommand,
  runIncidentShowCommand,
  runIncidentUpdateCommand,
  runIncidentEventsCommand,
} from "../src/commands/incidents.js";
import {
  runMcpListSourcesCommand,
  runMcpShowSourceCommand,
  runMcpQuarantineCommand,
  runMcpTrustCommand,
} from "../src/commands/mcp-sources.js";
import { runAuditVerifyCommand } from "../src/commands/audit.js";
import { runEventsCommand } from "../src/commands/events.js";

describe("CLI V4 Commands & --json Machine Mode", () => {
  let tmpDir: string;
  let dbPath: string;
  let logSpy: any;
  let logs: string[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-monitor-cli-v4-"));
    const monitorDir = path.join(tmpDir, ".agent-monitor");
    fs.mkdirSync(monitorDir, { recursive: true });
    dbPath = path.join(monitorDir, "data.db");

    const db = createDatabase(dbPath);
    const repo = new SessionRepository(db);

    repo.createSession({
      id: "ses_cli_v4",
      agentId: "agent-v4",
      agentName: "Agent V4",
      provider: "deepseek",
      model: "deepseek-chat",
      workspaceRoot: tmpDir,
      task: "Test CLI V4",
      status: "running",
      startedAt: Date.now(),
    });

    // Create initial policy versions
    repo.createPolicyVersion({
      name: "Default Policy",
      rules: [
        { id: "rule-1", action: "file.read", decision: "ALLOW" },
        { id: "rule-2", action: "file.write", decision: "ASK" },
      ],
      defaultDecision: "ALLOW",
      timeoutMs: 30000,
      createdBy: "admin",
      activate: true,
    });

    // Create an incident
    repo.createIncident({
      sessionId: "ses_cli_v4",
      severity: "HIGH",
      triggerType: "WORKSPACE_ESCAPE",
      title: "Workspace Escape Test",
      description: "Path escaped root directory",
    });

    // Register an MCP source
    repo.upsertMcpSource({
      sourceId: "mcp:fs-server",
      name: "fs-server",
      command: "npx",
      args: ["-y", "server-filesystem"],
      status: "HEALTHY",
    });

    // Insert a few chained events
    repo.insertEvent({
      id: "evt_1",
      sequence: 1,
      sessionId: "ses_cli_v4",
      agentId: "agent-v4",
      timestamp: Date.now(),
      type: "action.started",
      actionId: "act_1",
      kind: "file.read",
    } as any);

    repo.insertEvent({
      id: "evt_2",
      sequence: 2,
      sessionId: "ses_cli_v4",
      agentId: "agent-v4",
      timestamp: Date.now(),
      type: "action.completed",
      actionId: "act_1",
      kind: "file.read",
      durationMs: 10,
    } as any);

    db.close();

    logs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
      logs.push(msg);
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. policy commands support --json and rule mutation", async () => {
    // List versions
    await runPolicyVersionsCommand({ workspace: tmpDir, json: true });
    const versionsJson = JSON.parse(logs[logs.length - 1]);
    expect(versionsJson.versions).toHaveLength(1);
    expect(versionsJson.versions[0].versionNumber).toBe(1);

    // Disable rule
    await runPolicyToggleRuleCommand("rule-1", false, {
      workspace: tmpDir,
      json: true,
    });
    const toggleJson = JSON.parse(logs[logs.length - 1]);
    expect(toggleJson.success).toBe(true);
    expect(toggleJson.enabled).toBe(false);
    expect(toggleJson.version.versionNumber).toBe(2);

    // Diff v1 vs v2
    await runPolicyDiffCommand(1, 2, { workspace: tmpDir, json: true });
    const diffJson = JSON.parse(logs[logs.length - 1]);
    expect(diffJson.diff.modifiedRules).toHaveLength(1);
    expect(diffJson.diff.modifiedRules[0].ruleId).toBe("rule-1");

    // Rollback to v1
    await runPolicyRollbackCommand(1, { workspace: tmpDir, json: true });
    const rollbackJson = JSON.parse(logs[logs.length - 1]);
    expect(rollbackJson.success).toBe(true);
    expect(rollbackJson.activatedVersion.versionNumber).toBe(3);

    // History
    await runPolicyHistoryCommand({ workspace: tmpDir, json: true });
    const historyJson = JSON.parse(logs[logs.length - 1]);
    expect(historyJson.history.length).toBeGreaterThanOrEqual(2);
  });

  it("2. incidents commands support list, show, and update with --json", async () => {
    // List incidents
    await runIncidentsListCommand({ workspace: tmpDir, json: true });
    const listJson = JSON.parse(logs[logs.length - 1]);
    expect(listJson.incidents).toHaveLength(1);
    const incId = listJson.incidents[0].id;
    expect(listJson.incidents[0].triggerType).toBe("WORKSPACE_ESCAPE");

    // Show incident
    await runIncidentShowCommand(incId, { workspace: tmpDir, json: true });
    const showJson = JSON.parse(logs[logs.length - 1]);
    expect(showJson.incident.id).toBe(incId);
    expect(showJson.incident.status).toBe("OPEN");

    // Update incident
    await runIncidentUpdateCommand(
      incId,
      { status: "RESOLVED", notes: "Verified benign" },
      { workspace: tmpDir, json: true },
    );
    const updateJson = JSON.parse(logs[logs.length - 1]);
    expect(updateJson.success).toBe(true);
    expect(updateJson.incident.status).toBe("RESOLVED");
    expect(updateJson.incident.resolutionNotes).toBe("Verified benign");
  });

  it("3. mcp commands support list, show, quarantine, and trust with --json", async () => {
    // List sources
    await runMcpListSourcesCommand({ workspace: tmpDir, json: true });
    const listJson = JSON.parse(logs[logs.length - 1]);
    expect(listJson.sources).toHaveLength(1);
    expect(listJson.sources[0].sourceId).toBe("mcp:fs-server");

    // Quarantine source
    await runMcpQuarantineCommand("mcp:fs-server", "Operator detected breach", {
      workspace: tmpDir,
      json: true,
    });
    const qJson = JSON.parse(logs[logs.length - 1]);
    expect(qJson.success).toBe(true);
    expect(qJson.source.status).toBe("QUARANTINED");

    // Show source
    await runMcpShowSourceCommand("mcp:fs-server", {
      workspace: tmpDir,
      json: true,
    });
    const showJson = JSON.parse(logs[logs.length - 1]);
    expect(showJson.source.status).toBe("QUARANTINED");
    expect(showJson.source.quarantineReason).toBe("Operator detected breach");

    // Trust source
    await runMcpTrustCommand("mcp:fs-server", {
      workspace: tmpDir,
      json: true,
    });
    const trustJson = JSON.parse(logs[logs.length - 1]);
    expect(trustJson.success).toBe(true);
    expect(trustJson.source.status).toBe("HEALTHY");
    expect(trustJson.source.quarantineReason).toBeNull();
  });

  it("4. audit verify cryptographically verifies event hash chain", async () => {
    await runAuditVerifyCommand({ workspace: tmpDir, json: true });
    const auditJson = JSON.parse(logs[logs.length - 1]);
    expect(auditJson.verified).toBe(true);
    expect(auditJson.sessions).toHaveLength(1);
    expect(auditJson.sessions[0].verified).toBe(true);
    expect(auditJson.sessions[0].eventCount).toBe(2);
  });

  it("5. events command lists and filters recorded events with --json", async () => {
    await runEventsCommand({
      workspace: tmpDir,
      session: "ses_cli_v4",
      json: true,
    });
    const eventsJson = JSON.parse(logs[logs.length - 1]);
    expect(eventsJson.events).toHaveLength(2);
    expect(eventsJson.events[0].sequence).toBe(1);
    expect(eventsJson.events[1].sequence).toBe(2);
  });
});
