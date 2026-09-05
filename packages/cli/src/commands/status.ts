import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { PolicyEngine } from "@agent-monitor/core";
import { createDatabase, SessionRepository } from "@agent-monitor/server";

export interface StatusCommandOptions {
  workspace?: string;
  db?: string;
  port?: number;
  json?: boolean;
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

  let configInfo: any = { exists: false };
  if (fs.existsSync(configPath)) {
    try {
      const config = PolicyEngine.loadFromFile(configPath);
      configInfo = {
        exists: true,
        path: configPath,
        rulesCount: config.rules?.length || 0,
        defaultDecision: config.policy?.default || "ALLOW",
      };
    } catch (err: any) {
      configInfo = { exists: true, path: configPath, error: err.message };
    }
  }

  let dbInfo: any = { initialized: false };
  if (fs.existsSync(dbPath)) {
    try {
      const stats = fs.statSync(dbPath);
      const db = createDatabase(dbPath);
      const repo = new SessionRepository(db);
      const sessions = repo.listSessions(100);
      const pendingApprovals = repo.listApprovals(undefined, "pending");
      db.close();

      dbInfo = {
        initialized: true,
        path: dbPath,
        sizeBytes: stats.size,
        sizeKb: (stats.size / 1024).toFixed(1),
        sessionsCount: sessions.length,
        pendingApprovalsCount: pendingApprovals.length,
      };
    } catch (err: any) {
      dbInfo = { initialized: true, path: dbPath, error: err.message };
    }
  }

  let serverInfo: any = { running: false, port: serverPort };
  try {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      serverInfo = {
        running: true,
        port: serverPort,
        url: `http://127.0.0.1:${serverPort}`,
      };
    }
  } catch {}

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          workspace: workspaceRoot,
          config: configInfo,
          database: dbInfo,
          server: serverInfo,
          version: "4.1.1",
          timestamp: Date.now(),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    pc.bold(`\nAGENT MONITOR — System & Workspace Status (V4.1.1)\n`),
  );
  console.log(`  ${pc.bold("Workspace:")}        ${pc.white(workspaceRoot)}`);

  if (configInfo.exists && !configInfo.error) {
    console.log(
      `  ${pc.bold("Configuration:")}    ${pc.green("Found")} (${configInfo.rulesCount} custom rules, file: ${configPath})`,
    );
  } else if (configInfo.error) {
    console.log(
      `  ${pc.bold("Configuration:")}    ${pc.red("Error")} (${configInfo.error})`,
    );
  } else {
    console.log(
      `  ${pc.bold("Configuration:")}    ${pc.dim("Default built-in policies active (no agent-monitor.config.json)")}`,
    );
  }

  if (dbInfo.initialized && !dbInfo.error) {
    console.log(
      `  ${pc.bold("SQLite Storage:")}   ${pc.green("Active")} (${dbInfo.sessionsCount} sessions, ${dbInfo.sizeKb} KB, file: ${dbPath})`,
    );
  } else if (dbInfo.error) {
    console.log(
      `  ${pc.bold("SQLite Storage:")}   ${pc.yellow("Exists")} (${dbPath})`,
    );
  } else {
    console.log(
      `  ${pc.bold("SQLite Storage:")}   ${pc.dim("Not yet initialized (created on first run)")}`,
    );
  }

  if (serverInfo.running) {
    console.log(
      `  ${pc.bold("Monitor Server:")}   ${pc.green("Running")} on http://127.0.0.1:${serverPort}`,
    );
    console.log(
      `  ${pc.bold("Web Control Plane:")} ${pc.cyan(`http://127.0.0.1:${serverPort}`)}`,
    );
  } else {
    console.log(
      `  ${pc.bold("Monitor Server:")}   ${pc.dim(`Stopped (Start with 'agent-monitor server' or run during tasks)`)}`,
    );
  }

  console.log();
}
