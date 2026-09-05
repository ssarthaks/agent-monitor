import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { createDatabase, SessionRepository } from "@agent-monitor/server";

export interface SecurityCommandOptions {
  session?: string;
  workspace?: string;
  db?: string;
  port?: number;
}

export async function runSecurityFlowsCommand(
  options: SecurityCommandOptions = {},
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");
  const port = options.port || 4040;

  let sessionId = options.session;

  if (!sessionId && fs.existsSync(dbPath)) {
    const db = createDatabase(dbPath);
    const repo = new SessionRepository(db);
    const sessions = repo.listSessions(5);
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
    db.close();
  }

  let flows: any[] | null = null;
  if (sessionId) {
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/sessions/${sessionId}/security-flows`,
      );
      if (res.ok) {
        flows = await res.json();
      }
    } catch {
      // fallback to SQLite
    }
  }

  if (!flows) {
    if (!fs.existsSync(dbPath)) {
      console.error(pc.red(`Error: SQLite database not found at ${dbPath}`));
      process.exit(1);
    }

    const db = createDatabase(dbPath);
    const repo = new SessionRepository(db);
    try {
      if (sessionId) {
        flows = repo.getBehavioralMatches(sessionId);
      } else {
        const rows = db
          .prepare(
            `SELECT * FROM behavioral_matches ORDER BY created_at DESC LIMIT 50`,
          )
          .all() as any[];
        flows = rows.map((r) => ({
          id: r.id,
          sessionId: r.session_id,
          ruleId: r.rule_id,
          name: r.name,
          severity: r.severity,
          reason: r.reason,
          triggeringActionId: r.triggering_action_id,
          priorActionIds: JSON.parse(r.prior_action_ids_json || "[]"),
          createdAt: r.created_at,
        }));
      }
    } finally {
      db.close();
    }
  }

  console.log(
    pc.bold(
      `\nAGENT MONITOR — Behavioral Data Flows & Security Sequences (V4.1.1)\n`,
    ),
  );

  if (!flows || flows.length === 0) {
    console.log(
      pc.green(
        sessionId
          ? `  ✓ No suspicious data-flow sequences detected for session '${sessionId}'.`
          : `  ✓ No suspicious data-flow sequences detected in database.`,
      ),
    );
    console.log();
    return;
  }

  console.log(
    `  ${pc.bold("Session:")}   ${pc.cyan(sessionId || "All sessions")}`,
  );
  console.log(
    `  ${pc.bold("Detected:")}  ${flows.length} behavioral match(es)\n`,
  );

  for (const flow of flows) {
    const sevColor =
      flow.severity === "CRITICAL"
        ? pc.bold(pc.red("CRITICAL"))
        : flow.severity === "HIGH"
          ? pc.red("HIGH")
          : pc.yellow("MEDIUM");

    const timeStr = new Date(flow.createdAt).toLocaleTimeString();

    console.log(
      `  [${pc.dim(timeStr)}] ${sevColor} ${pc.bold(flow.name)} (${pc.dim(flow.ruleId)})`,
    );
    console.log(`  ${pc.white("├─ Reason:")}     ${flow.reason}`);
    console.log(
      `  ${pc.white("├─ Trigger:")}    Action ${pc.cyan(flow.triggeringActionId || "unknown")}`,
    );
    if (flow.priorActionIds && flow.priorActionIds.length > 0) {
      console.log(
        `  ${pc.white("└─ Prior Steps:")} ${flow.priorActionIds.map((id: string) => pc.dim(id)).join(" ──► ")}`,
      );
    } else {
      console.log(`  ${pc.white("└─ Prior Steps:")} (none)`);
    }
    console.log();
  }
}
