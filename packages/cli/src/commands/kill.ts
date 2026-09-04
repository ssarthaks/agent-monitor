import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { createDatabase, SessionRepository } from "@agent-monitor/server";

export interface KillCommandOptions {
  session?: string;
  workspace?: string;
  db?: string;
  port?: number;
  reason?: string;
}

function resolveSession(
  repo: SessionRepository,
  explicitId?: string,
): string | null {
  if (explicitId) return explicitId;
  const sessions = repo.listSessions(10);
  const running = sessions.find((s) => s.status === "running");
  if (running) return running.id;
  if (sessions.length > 0) return sessions[0].id;
  return null;
}

export async function runKillCommand(
  options: KillCommandOptions = {},
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");
  const port = options.port || 4040;
  const reason = options.reason || "Killed by operator via CLI";

  let sessionId = options.session;

  if (!sessionId) {
    if (fs.existsSync(dbPath)) {
      const db = createDatabase(dbPath);
      const repo = new SessionRepository(db);
      sessionId = resolveSession(repo) || undefined;
      db.close();
    }
  }

  if (!sessionId) {
    console.error(pc.red("Error: No active session found to kill."));
    console.error(
      pc.dim("Specify a session explicitly: agent-monitor kill --session <id>"),
    );
    process.exit(1);
  }

  // 1. Try sending kill to running Monitor Server over REST API
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/sessions/${sessionId}/kill`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, activatedBy: "cli-operator" }),
      },
    );

    if (res.ok) {
      console.log(
        pc.bold(
          pc.red(
            `\n🛑 KILL SWITCH ACTIVATED for session '${sessionId}' via HTTP server.\n`,
          ),
        ),
      );
      console.log(`  ${pc.bold("Session ID:")}  ${sessionId}`);
      console.log(`  ${pc.bold("Reason:")}      ${reason}`);
      console.log(
        `  ${pc.bold("Status:")}      ${pc.red("KILLED (All future actions blocked)")}\n`,
      );
      return;
    }
  } catch {
    // Server might not be running; fall back to direct SQLite modification
  }

  // 2. Direct SQLite fallback
  if (!fs.existsSync(dbPath)) {
    console.error(
      pc.red(
        `Error: SQLite database not found at ${dbPath} and server not reachable.`,
      ),
    );
    process.exit(1);
  }

  const db = createDatabase(dbPath);
  const repo = new SessionRepository(db);

  try {
    repo.setKillSwitch(sessionId, true, reason, "cli-operator");
    console.log(
      pc.bold(
        pc.red(
          `\n🛑 KILL SWITCH ACTIVATED for session '${sessionId}' in SQLite storage.\n`,
        ),
      ),
    );
    console.log(`  ${pc.bold("Session ID:")}  ${sessionId}`);
    console.log(`  ${pc.bold("Reason:")}      ${reason}`);
    console.log(
      `  ${pc.bold("Status:")}      ${pc.red("KILLED (Authoritative local circuit breaker)")}\n`,
    );
  } finally {
    db.close();
  }
}

export async function runResumeCommand(
  options: KillCommandOptions = {},
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");
  const port = options.port || 4040;

  let sessionId = options.session;

  if (!sessionId) {
    if (fs.existsSync(dbPath)) {
      const db = createDatabase(dbPath);
      const repo = new SessionRepository(db);
      sessionId = resolveSession(repo) || undefined;
      db.close();
    }
  }

  if (!sessionId) {
    console.error(pc.red("Error: No session found to resume."));
    console.error(
      pc.dim(
        "Specify a session explicitly: agent-monitor resume --session <id>",
      ),
    );
    process.exit(1);
  }

  // 1. Try sending resume to running Monitor Server over REST API
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/sessions/${sessionId}/resume`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumedBy: "cli-operator" }),
      },
    );

    if (res.ok) {
      console.log(
        pc.bold(
          pc.green(
            `\n▶️  KILL SWITCH DEACTIVATED for session '${sessionId}' via HTTP server.\n`,
          ),
        ),
      );
      console.log(`  ${pc.bold("Session ID:")}  ${sessionId}`);
      console.log(
        `  ${pc.bold("Status:")}      ${pc.green("RUNNING (Action execution resumed)")}\n`,
      );
      return;
    }
  } catch {
    // Server might not be running; fall back to direct SQLite modification
  }

  // 2. Direct SQLite fallback
  if (!fs.existsSync(dbPath)) {
    console.error(
      pc.red(
        `Error: SQLite database not found at ${dbPath} and server not reachable.`,
      ),
    );
    process.exit(1);
  }

  const db = createDatabase(dbPath);
  const repo = new SessionRepository(db);

  try {
    repo.setKillSwitch(sessionId, false, undefined, "cli-operator");
    console.log(
      pc.bold(
        pc.green(
          `\n▶️  KILL SWITCH DEACTIVATED for session '${sessionId}' in SQLite storage.\n`,
        ),
      ),
    );
    console.log(`  ${pc.bold("Session ID:")}  ${sessionId}`);
    console.log(
      `  ${pc.bold("Status:")}      ${pc.green("RESUMED (Action execution unblocked)")}\n`,
    );
  } finally {
    db.close();
  }
}
