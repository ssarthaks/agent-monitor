import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { PolicyEngine } from "@agent-monitor/core";
import { createDatabase, SessionRepository } from "@agent-monitor/server";

export interface StatusCommandOptions {
  workspace?: string;
  db?: string;
  port?: number;
}

export async function runStatusCommand(
  options: StatusCommandOptions = {},
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const configPath = path.join(workspaceRoot, "agent-monitor.config.json");
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(workspaceRoot, ".agent-monitor", "data.db");
  const serverPort = options.port || 4040;

  console.log(pc.bold(`\nAGENT MONITOR — System & Workspace Status (V0.2)\n`));
  console.log(`  ${pc.bold("Workspace:")}        ${pc.white(workspaceRoot)}`);

  // Configuration check
  if (fs.existsSync(configPath)) {
    try {
      const config = PolicyEngine.loadFromFile(configPath);
      const rulesCount = config.rules?.length || 0;
      console.log(
        `  ${pc.bold("Configuration:")}    ${pc.green("Found")} (${rulesCount} custom rules, file: ${configPath})`,
      );
    } catch (err: any) {
      console.log(
        `  ${pc.bold("Configuration:")}    ${pc.red("Error")} (${err.message})`,
      );
    }
  } else {
    console.log(
      `  ${pc.bold("Configuration:")}    ${pc.dim("Default built-in policies active (no agent-monitor.config.json)")}`,
    );
  }

  // Database check
  if (fs.existsSync(dbPath)) {
    try {
      const stats = fs.statSync(dbPath);
      const db = createDatabase(dbPath);
      const repo = new SessionRepository(db);
      const sessions = repo.listSessions(100);
      db.close();

      const sizeKb = (stats.size / 1024).toFixed(1);
      console.log(
        `  ${pc.bold("SQLite Storage:")}   ${pc.green("Active")} (${sessions.length} sessions, ${sizeKb} KB, file: ${dbPath})`,
      );
    } catch {
      console.log(
        `  ${pc.bold("SQLite Storage:")}   ${pc.yellow("Exists")} (${dbPath})`,
      );
    }
  } else {
    console.log(
      `  ${pc.bold("SQLite Storage:")}   ${pc.dim("Not yet initialized (created on first run)")}`,
    );
  }

  // Server health check
  try {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      console.log(
        `  ${pc.bold("Monitor Server:")}   ${pc.green("Running")} on http://127.0.0.1:${serverPort}`,
      );
      console.log(
        `  ${pc.bold("Web Control Plane:")} ${pc.cyan(`http://127.0.0.1:${serverPort}`)}`,
      );
    } else {
      console.log(
        `  ${pc.bold("Monitor Server:")}   ${pc.yellow("Non-200 response")} from port ${serverPort}`,
      );
    }
  } catch {
    console.log(
      `  ${pc.bold("Monitor Server:")}   ${pc.dim(`Stopped (Start with 'agent-monitor server' or run during tasks)`)}`,
    );
  }

  console.log();
}
