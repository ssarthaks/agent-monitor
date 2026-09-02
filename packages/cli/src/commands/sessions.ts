import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { createDatabase, SessionRepository } from "@agent-monitor/server";

export interface SessionsCommandOptions {
  workspace?: string;
  db?: string;
  limit?: number;
}

export async function runSessionsCommand(
  options: SessionsCommandOptions = {},
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(workspaceRoot, ".agent-monitor", "data.db");

  if (!fs.existsSync(dbPath)) {
    console.log(pc.yellow(`\n⚠️  No SQLite database found at: ${dbPath}`));
    console.log(
      pc.dim(
        `Run an agent task first using 'agent-monitor run --task "..."' to create a session.\n`,
      ),
    );
    return;
  }

  const db = createDatabase(dbPath);
  const repository = new SessionRepository(db);
  const limit = options.limit || 20;
  const sessions = repository.listSessions(limit);
  db.close();

  if (sessions.length === 0) {
    console.log(pc.yellow(`\n⚠️  No recorded sessions found in database.`));
    console.log(`   Database: ${pc.dim(dbPath)}\n`);
    return;
  }

  console.log(
    pc.bold(`\nAGENT MONITOR — Recorded Sessions (${sessions.length} shown)\n`),
  );
  console.log(
    pc.dim(
      "  " +
        "SESSION ID".padEnd(26) +
        "STATUS".padEnd(12) +
        "RISK".padEnd(10) +
        "TASK".padEnd(40) +
        "STARTED",
    ),
  );
  console.log(pc.dim("  " + "─".repeat(100)));

  for (const s of sessions) {
    const statusColor =
      s.status === "completed"
        ? pc.green("completed")
        : s.status === "running"
          ? pc.cyan("running")
          : pc.red(s.status);

    const riskColor =
      s.riskScore >= 70
        ? pc.red(`${s.riskScore}/100`)
        : s.riskScore >= 30
          ? pc.yellow(`${s.riskScore}/100`)
          : pc.green(`${s.riskScore}/100`);

    const taskSnippet =
      s.task.length > 37 ? s.task.slice(0, 34) + "..." : s.task;
    const dateStr = new Date(s.startedAt).toLocaleString();

    console.log(
      "  " +
        pc.white(s.id.padEnd(26)) +
        statusColor.padEnd(21) +
        riskColor.padEnd(19) +
        pc.white(taskSnippet.padEnd(40)) +
        pc.dim(dateStr),
    );
  }

  console.log(pc.dim(`\n  Database: ${dbPath}`));
  console.log(
    pc.dim(
      `  To view full session details in the Web UI: agent-monitor server\n`,
    ),
  );
}
