import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { createDatabase, SessionRepository } from "@agent-monitor/server";

export interface ToolsCommandOptions {
  session?: string;
  workspace?: string;
  db?: string;
  port?: number;
}

export async function runToolsCommand(
  options: ToolsCommandOptions = {},
): Promise<void> {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");
  const port = options.port || 4040;

  let sessionId = options.session;

  // 1. If no session given, try finding latest session from DB
  if (!sessionId && fs.existsSync(dbPath)) {
    const db = createDatabase(dbPath);
    const repo = new SessionRepository(db);
    const sessions = repo.listSessions(5);
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    }
    db.close();
  }

  // 2. Fetch tools from HTTP server if possible
  let tools: any[] | null = null;
  if (sessionId) {
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/sessions/${sessionId}/tools`,
      );
      if (res.ok) {
        tools = await res.json();
      }
    } catch {
      // fallback to SQLite
    }
  }

  // 3. Fallback to SQLite query
  if (!tools) {
    if (!fs.existsSync(dbPath)) {
      console.error(pc.red(`Error: SQLite database not found at ${dbPath}`));
      process.exit(1);
    }

    const db = createDatabase(dbPath);
    const repo = new SessionRepository(db);
    try {
      if (sessionId) {
        tools = repo.getToolFingerprints(sessionId);
      } else {
        const rows = db
          .prepare(
            `SELECT * FROM tool_fingerprints ORDER BY last_seen_at DESC LIMIT 50`,
          )
          .all() as any[];
        tools = rows.map((r) => ({
          sessionId: r.session_id,
          toolName: r.tool_name,
          source: r.source,
          initialFingerprint: r.initial_fingerprint || r.fingerprint,
          fingerprint: r.fingerprint,
          description: r.description,
          changeCount: r.change_count,
          lastSeenAt: r.last_seen_at,
        }));
      }
    } finally {
      db.close();
    }
  }

  console.log(
    pc.bold(
      `\nAGENT MONITOR — External Tool Fingerprints & Integrity (V4.1.0)\n`,
    ),
  );

  if (!tools || tools.length === 0) {
    console.log(
      pc.dim(
        sessionId
          ? `  No external tools registered yet for session '${sessionId}'.`
          : `  No external tools registered in database.`,
      ),
    );
    console.log();
    return;
  }

  console.log(
    `  ${pc.bold("Session:")}   ${pc.cyan(sessionId || "All sessions")}`,
  );
  console.log(`  ${pc.bold("Total:")}     ${tools.length} external tool(s)\n`);

  console.log(
    `  ${"TOOL NAME".padEnd(20)} ${"SOURCE".padEnd(16)} ${"STATUS".padEnd(14)} ${"MUTATIONS".padEnd(12)} ${"FINGERPRINT (SHA-256)".padEnd(24)}`,
  );
  console.log(
    `  ${"─".repeat(20)} ${"─".repeat(16)} ${"─".repeat(14)} ${"─".repeat(12)} ${"─".repeat(24)}`,
  );

  for (const t of tools) {
    const isMutated =
      (t.initialFingerprint && t.fingerprint !== t.initialFingerprint) ||
      t.changeCount > 0;
    const statusStr = isMutated ? pc.red("MUTATED") : pc.green("UNCHANGED");
    const changesStr =
      t.changeCount > 0 ? pc.yellow(String(t.changeCount)) : pc.dim("0");
    const shortFp = t.fingerprint ? t.fingerprint.substring(0, 16) + "…" : "—";

    console.log(
      `  ${pc.bold(t.toolName.padEnd(20))} ${String(t.source || "mcp").padEnd(16)} ${statusStr.padEnd(23)} ${changesStr.padEnd(21)} ${pc.dim(shortFp)}`,
    );
    if (t.description) {
      console.log(`    ${pc.dim(`↳ Description: ${t.description}`)}`);
    }
    if (isMutated && t.initialFingerprint) {
      console.log(
        `    ${pc.red(`↳ Baseline FP: ${t.initialFingerprint.substring(0, 16)}… (Schema mutated!)`)}`,
      );
    }
  }

  console.log();
}
