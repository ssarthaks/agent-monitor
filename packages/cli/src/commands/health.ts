import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import {
  createDatabase,
  checkDatabaseHealth,
  DatabaseHealthInfo,
} from "@agent-monitor/server";

export interface HealthCommandOptions {
  workspace?: string;
  db?: string;
  port?: number;
  json?: boolean;
}

export async function runHealthCommand(
  options: HealthCommandOptions = {},
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(workspaceRoot, ".agent-monitor", "data.db");
  const serverPort = options.port || 4040;

  let dbHealth: DatabaseHealthInfo | null = null;
  let serverHealth: any = null;

  if (fs.existsSync(dbPath)) {
    try {
      const db = createDatabase(dbPath);
      dbHealth = checkDatabaseHealth(db);
      db.close();
    } catch (err: any) {
      dbHealth = {
        status: "corrupt",
        journalMode: "unknown",
        foreignKeys: false,
        busyTimeout: 0,
        pageSize: 0,
        pageCount: 0,
        integrityCheck: err.message,
        quickCheck: err.message,
        migrationsVersion: 0,
        checkedAt: Date.now(),
      };
    }
  }

  try {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      serverHealth = await res.json();
    }
  } catch {}

  const overallStatus =
    dbHealth?.status === "corrupt"
      ? "unhealthy"
      : dbHealth?.status === "ok"
        ? "healthy"
        : "degraded";

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          status: overallStatus,
          database: dbHealth,
          server: serverHealth,
          workspace: workspaceRoot,
          timestamp: Date.now(),
          version: "4.1.0",
        },
        null,
        2,
      ),
    );
    if (overallStatus === "unhealthy") {
      process.exitCode = 3;
    }
    return;
  }

  console.log(pc.bold("\nAGENT MONITOR — Health Diagnostics (V4.1.0)\n"));
  console.log(
    `  Overall Status:  ${
      overallStatus === "healthy"
        ? pc.green("● HEALTHY")
        : pc.red("● " + overallStatus.toUpperCase())
    }`,
  );
  console.log(`  Database Path:   ${pc.white(dbPath)}`);
  if (dbHealth) {
    console.log(
      `  DB Status:       ${
        dbHealth.status === "ok" ? pc.green("OK") : pc.red(dbHealth.status)
      }`,
    );
    console.log(
      `  Journal Mode:    ${pc.cyan(dbHealth.journalMode.toUpperCase())}`,
    );
    console.log(
      `  Integrity Check: ${
        dbHealth.integrityCheck === "ok"
          ? pc.green("ok")
          : pc.red(dbHealth.integrityCheck)
      }`,
    );
    console.log(
      `  Quick Check:     ${
        dbHealth.quickCheck === "ok"
          ? pc.green("ok")
          : pc.red(dbHealth.quickCheck)
      }`,
    );
    console.log(
      `  Migration Ver:   ${pc.yellow(dbHealth.migrationsVersion.toString())}`,
    );
  } else {
    console.log(`  DB Status:       ${pc.dim("Database file not found")}`);
  }

  if (serverHealth) {
    console.log(
      `  Server API:      ${pc.green("Online")} on http://127.0.0.1:${serverPort}`,
    );
  } else {
    console.log(`  Server API:      ${pc.dim("Offline")}`);
  }
  console.log();

  if (overallStatus === "unhealthy") {
    process.exitCode = 3;
  }
}
