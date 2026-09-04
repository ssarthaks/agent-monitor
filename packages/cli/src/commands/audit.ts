import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { createDatabase, SessionRepository } from "@agent-monitor/server";
import { verifyEventChain } from "@agent-monitor/core";

export interface AuditCliOptions {
  workspace?: string;
  db?: string;
  session?: string;
  json?: boolean;
}

function getRepo(options: AuditCliOptions): {
  repo: SessionRepository;
  db: any;
  close: () => void;
} {
  const workspaceRoot = path.resolve(options.workspace || process.cwd());
  const dbDir = path.join(workspaceRoot, ".agent-monitor");
  const dbPath = options.db
    ? path.resolve(options.db)
    : path.join(dbDir, "data.db");

  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found at: ${dbPath}`);
  }

  const db = createDatabase(dbPath);
  const repo = new SessionRepository(db);
  return { repo, db, close: () => db.close() };
}

export async function runAuditVerifyCommand(
  options: AuditCliOptions = {},
): Promise<void> {
  const { repo, db, close } = getRepo(options);
  try {
    let sessionIds: string[] = [];
    if (options.session) {
      sessionIds = [options.session];
    } else {
      const sessions = repo.listSessions(100);
      sessionIds = sessions.map((s) => s.id);
    }

    const results: Array<{
      sessionId: string;
      eventCount: number;
      verified: boolean;
      brokenAtSequence?: number;
      reason?: string;
    }> = [];

    for (const sid of sessionIds) {
      const events = repo.getEvents(sid);
      const verification = verifyEventChain(events);
      results.push({
        sessionId: sid,
        eventCount: events.length,
        verified: verification.verified,
        brokenAtSequence: verification.brokenAtSequence,
        reason: verification.reason,
      });
    }

    const allValid = results.every((r) => r.verified);

    if (options.json) {
      console.log(
        JSON.stringify({ verified: allValid, sessions: results }, null, 2),
      );
      return;
    }

    console.log(
      pc.bold("\nAGENT MONITOR — Cryptographic Audit Log Verification (V4)\n"),
    );
    if (results.length === 0) {
      console.log(pc.dim("  No sessions found to verify.\n"));
      return;
    }

    for (const r of results) {
      if (r.verified) {
        console.log(
          `  ✓ Session ${pc.cyan(r.sessionId)}: ${pc.green("CHAIN VALID")} (${r.eventCount} events)`,
        );
      } else {
        console.log(
          `  ❌ Session ${pc.cyan(r.sessionId)}: ${pc.red("TAMPER DETECTED / BROKEN CHAIN")}`,
        );
        console.log(`     Failed at Sequence #${r.brokenAtSequence}`);
        if (r.reason) console.log(`     Reason: ${r.reason}`);
      }
    }

    console.log();
    if (allValid) {
      console.log(
        pc.green(
          "✓ Audit trail integrity cryptographically verified. Zero tampering detected.\n",
        ),
      );
    } else {
      console.log(
        pc.red(
          "❌ Audit trail verification failed! Potential database tampering detected.\n",
        ),
      );
      process.exitCode = 3;
    }
  } finally {
    close();
  }
}

export interface AuditExportOptions extends AuditCliOptions {
  output?: string;
}

export async function runAuditExportCommand(
  options: AuditExportOptions = {},
): Promise<void> {
  const { repo, close } = getRepo(options);
  try {
    const ledger = repo.exportLedger(options.session);

    if (options.output) {
      const outPath = path.resolve(options.output);
      fs.writeFileSync(outPath, ledger, "utf8");
      if (!options.json) {
        console.log(
          pc.green(`✓ Exported canonical audit ledger to: ${outPath}`),
        );
      } else {
        console.log(JSON.stringify({ exported: true, path: outPath }));
      }
    } else {
      console.log(ledger);
    }
  } finally {
    close();
  }
}
