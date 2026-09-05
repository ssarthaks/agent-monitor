import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ensureGitIgnore, resolveStorageDir, resolveDatabasePath } from "../src/storage.js";

describe("Storage & Git Exclusion Automation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-monitor-storage-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.AGENT_MONITOR_GLOBAL_STORAGE;
  });

  it("automatically creates .gitignore if inside git repo and appends .agent-monitor/", () => {
    const gitDir = path.join(tmpDir, ".git");
    fs.mkdirSync(gitDir, { recursive: true });

    resolveStorageDir(tmpDir);

    const gitignorePath = path.join(tmpDir, ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const content = fs.readFileSync(gitignorePath, "utf8");
    expect(content).toContain(".agent-monitor/");
  });

  it("appends to existing .gitignore without duplicating entries", () => {
    const gitDir = path.join(tmpDir, ".git");
    fs.mkdirSync(gitDir, { recursive: true });

    const gitignorePath = path.join(tmpDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules/\n.env\n", "utf8");

    ensureGitIgnore(tmpDir);
    ensureGitIgnore(tmpDir); // Second call must be idempotent

    const content = fs.readFileSync(gitignorePath, "utf8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".agent-monitor/");
    const occurrences = (content.match(/\.agent-monitor\//g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("updates .git/info/exclude if it exists", () => {
    const gitExcludeDir = path.join(tmpDir, ".git", "info");
    fs.mkdirSync(gitExcludeDir, { recursive: true });
    const excludeFile = path.join(gitExcludeDir, "exclude");
    fs.writeFileSync(excludeFile, "# existing\n", "utf8");

    ensureGitIgnore(tmpDir);

    const content = fs.readFileSync(excludeFile, "utf8");
    expect(content).toContain(".agent-monitor/");
  });

  it("supports global storage when AGENT_MONITOR_GLOBAL_STORAGE is set", () => {
    process.env.AGENT_MONITOR_GLOBAL_STORAGE = "true";
    const dir = resolveStorageDir(tmpDir);
    expect(dir).toContain(path.join(os.homedir(), ".agent-monitor", "workspaces"));
    expect(fs.existsSync(dir)).toBe(true);

    const dbPath = resolveDatabasePath(tmpDir);
    expect(dbPath).toBe(path.join(dir, "data.db"));
  });
});
