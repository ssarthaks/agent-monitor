import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  runConfigInitCommand,
  runConfigValidateCommand,
} from "../src/commands/config.js";
import { PolicyEngine } from "@agent-monitor/core";

describe("CLI Commands & Configuration Bootstrap", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-monitor-cli-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("config init creates a valid agent-monitor.config.json file", async () => {
    const configPath = path.join(tmpDir, "agent-monitor.config.json");
    expect(fs.existsSync(configPath)).toBe(false);

    await runConfigInitCommand({ workspace: tmpDir });

    expect(fs.existsSync(configPath)).toBe(true);

    const rawContent = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(rawContent);

    expect(parsed.policy.default).toBe("ALLOW");
    expect(Array.isArray(parsed.rules)).toBe(true);
    expect(parsed.rules.length).toBeGreaterThanOrEqual(3);

    // Validate with PolicyEngine
    const validation = PolicyEngine.validateConfig(parsed);
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it("config init does not overwrite existing configuration without --force", async () => {
    const configPath = path.join(tmpDir, "agent-monitor.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ custom: "preserved" }),
      "utf8",
    );

    await runConfigInitCommand({ workspace: tmpDir, force: false });

    const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(content.custom).toBe("preserved");
  });

  it("config init overwrites existing configuration when --force is provided", async () => {
    const configPath = path.join(tmpDir, "agent-monitor.config.json");
    fs.writeFileSync(configPath, JSON.stringify({ custom: "old" }), "utf8");

    await runConfigInitCommand({ workspace: tmpDir, force: true });

    const content = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(content.policy.default).toBe("ALLOW");
  });

  it("kill and resume commands toggle kill switch in SQLite database", async () => {
    const { runKillCommand, runResumeCommand } =
      await import("../src/commands/kill.js");
    const { createDatabase, SessionRepository } =
      await import("@agent-monitor/server");

    const dbPath = path.join(tmpDir, "data.db");
    const db = createDatabase(dbPath);
    const repo = new SessionRepository(db);

    repo.createSession({
      id: "ses_cli_kill_test",
      agentId: "agent-1",
      agentName: "Agent 1",
      provider: "deepseek",
      model: "deepseek-chat",
      workspaceRoot: tmpDir,
      task: "Test Kill Command",
      startedAt: Date.now(),
      status: "running",
      riskScore: 0,
    });
    db.close();

    // 1. Activate kill switch via CLI
    await runKillCommand({
      session: "ses_cli_kill_test",
      db: dbPath,
      reason: "Emergency kill test",
    });

    const dbCheck1 = createDatabase(dbPath);
    const repoCheck1 = new SessionRepository(dbCheck1);
    expect(repoCheck1.isKillSwitchActive("ses_cli_kill_test")).toBe(true);
    dbCheck1.close();

    // 2. Resume session via CLI
    await runResumeCommand({
      session: "ses_cli_kill_test",
      db: dbPath,
    });

    const dbCheck2 = createDatabase(dbPath);
    const repoCheck2 = new SessionRepository(dbCheck2);
    expect(repoCheck2.isKillSwitchActive("ses_cli_kill_test")).toBe(false);
    dbCheck2.close();
  });

  it("tools and security flows commands execute cleanly without error", async () => {
    const { runToolsCommand } = await import("../src/commands/tools.js");
    const { runSecurityFlowsCommand } =
      await import("../src/commands/security.js");
    const { createDatabase, SessionRepository } =
      await import("@agent-monitor/server");

    const dbPath = path.join(tmpDir, "data.db");
    const db = createDatabase(dbPath);
    const repo = new SessionRepository(db);

    repo.createSession({
      id: "ses_cli_tools_test",
      agentId: "agent-2",
      agentName: "Agent 2",
      provider: "mcp",
      model: "external",
      workspaceRoot: tmpDir,
      task: "Test Tools Command",
      startedAt: Date.now(),
      status: "running",
      riskScore: 0,
    });

    repo.recordToolFingerprint({
      id: "tf_1",
      sessionId: "ses_cli_tools_test",
      toolName: "list_files",
      source: "mcp:fs",
      fingerprint: "abc12345",
      schemaJson: "{}",
      description: "List directory files",
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
    });

    repo.recordBehavioralMatch({
      id: "bm_1",
      sessionId: "ses_cli_tools_test",
      ruleId: "SEC_SENSITIVE_TO_NETWORK",
      name: "Sensitive File Exfiltration",
      severity: "CRITICAL",
      reason: "Read .env followed by network call",
      triggeringActionId: "act_2",
      priorActionIds: ["act_1"],
      createdAt: Date.now(),
    });

    db.close();

    // Should execute cleanly without throwing
    await expect(
      runToolsCommand({ session: "ses_cli_tools_test", db: dbPath }),
    ).resolves.not.toThrow();

    await expect(
      runSecurityFlowsCommand({ session: "ses_cli_tools_test", db: dbPath }),
    ).resolves.not.toThrow();
  });

  it("policy check correctly detects outside-workspace paths and evaluates to DENY", async () => {
    const { runPolicyCheckCommand } = await import("../src/commands/check.js");

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
    };

    try {
      // 1. Check path outside workspace
      await runPolicyCheckCommand({
        action: "file.read",
        path: "../../etc/passwd",
        workspace: tmpDir,
      });

      const output1 = logs.join("\n");
      expect(output1).toContain("OUTSIDE WORKSPACE");
      expect(output1).toContain("DENY");
      expect(output1).toContain("deny-outside-workspace");

      logs.length = 0;

      // 2. Check path inside workspace
      await runPolicyCheckCommand({
        action: "file.read",
        path: "safe-file.txt",
        workspace: tmpDir,
      });

      const output2 = logs.join("\n");
      expect(output2).not.toContain("OUTSIDE WORKSPACE");
      expect(output2).toContain("ALLOW");
    } finally {
      console.log = originalLog;
    }
  });
});
