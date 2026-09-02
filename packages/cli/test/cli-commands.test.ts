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
});
