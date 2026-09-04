import path from "node:path";
import fs from "node:fs";
import pc from "picocolors";
import { createDatabase, SessionRepository } from "@agent-monitor/server";

export interface EventsCliOptions {
  workspace?: string;
  db?: string;
  session?: string;
  type?: string;
  limit?: number;
  json?: boolean;
}

function getRepo(options: EventsCliOptions): {
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

export async function runEventsCommand(
  options: EventsCliOptions = {},
): Promise<void> {
  const { repo, db, close } = getRepo(options);
  try {
    const limit = options.limit || 50;
    let events: any[] = [];

    if (options.session) {
      events = repo.getEvents(options.session);
      if (options.type) {
        events = events.filter((e) => e.type === options.type);
      }
      if (limit && events.length > limit) {
        events = events.slice(-limit);
      }
    } else {
      let query = "SELECT * FROM events";
      const params: any[] = [];
      if (options.type) {
        query += " WHERE type = ?";
        params.push(options.type);
      }
      query += " ORDER BY timestamp DESC LIMIT ?";
      params.push(limit);

      const rows = db.prepare(query).all(...params) as any[];
      events = rows.map((r: any) => ({
        id: r.id,
        sequence: r.sequence,
        sessionId: r.session_id,
        agentId: r.agent_id,
        timestamp: r.timestamp,
        type: r.type,
        data: r.data_json ? JSON.parse(r.data_json) : undefined,
        hash: r.hash,
        prevHash: r.prev_hash,
      }));
    }

    if (options.json) {
      console.log(JSON.stringify({ events }, null, 2));
      return;
    }

    console.log(pc.bold("\nAGENT MONITOR — Event Log Stream\n"));
    if (events.length === 0) {
      console.log(pc.dim("  No events found matching query.\n"));
      return;
    }

    for (const evt of events) {
      const typeColor = evt.type.includes("blocked")
        ? pc.red
        : evt.type.includes("completed")
          ? pc.green
          : evt.type.includes("incident")
            ? pc.magenta
            : pc.cyan;

      console.log(
        `  #${evt.sequence} [${typeColor(evt.type)}] ${new Date(evt.timestamp).toISOString()} (Session: ${evt.sessionId})`,
      );
      if (evt.hash) {
        console.log(
          `    Hash: ${evt.hash.substring(0, 16)}... | Prev: ${evt.prevHash ? evt.prevHash.substring(0, 16) + "..." : "GENESIS"}`,
        );
      }
      if (evt.reason) console.log(`    Reason: ${evt.reason}`);
      if (evt.kind) console.log(`    Kind: ${evt.kind}`);
      console.log();
    }
  } finally {
    close();
  }
}
