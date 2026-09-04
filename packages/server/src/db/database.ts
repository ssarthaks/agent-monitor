import DatabaseConstructor, { Database } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function createDatabase(dbPath: string = ":memory:"): Database {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseConstructor(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initSchema(db);
  return db;
}

function initSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        task TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'interrupted', 'killed')),
        risk_score INTEGER DEFAULT 0,
        summary_json TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        action_id TEXT,
        action_kind TEXT,
        payload_json TEXT NOT NULL,
        risk_level TEXT,
        risk_score INTEGER,
        risk_flags_json TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        action_kind TEXT NOT NULL,
        category TEXT NOT NULL,
        params_json TEXT NOT NULL,
        risk_score INTEGER DEFAULT 0,
        risk_level TEXT,
        risk_flags_json TEXT,
        reason TEXT NOT NULL,
        matched_policies_json TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'denied', 'expired')),
        resolved_by TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_fingerprints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        source TEXT NOT NULL,
        initial_fingerprint TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        schema_json TEXT,
        description TEXT,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        change_count INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS behavioral_matches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        name TEXT NOT NULL,
        severity TEXT NOT NULL,
        reason TEXT NOT NULL,
        triggering_action_id TEXT,
        prior_action_ids_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS control_state (
        session_id TEXT PRIMARY KEY,
        kill_switch_active INTEGER NOT NULL DEFAULT 0,
        activated_at INTEGER,
        activated_by TEXT,
        reason TEXT,
        resumed_at INTEGER,
        resumed_by TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_events_action_id ON events(action_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_tool_fingerprints_session ON tool_fingerprints(session_id, tool_name, source);
    CREATE INDEX IF NOT EXISTS idx_behavioral_matches_session ON behavioral_matches(session_id);
  `);

  try {
    db.exec(
      "ALTER TABLE tool_fingerprints ADD COLUMN initial_fingerprint TEXT",
    );
    db.exec(
      "UPDATE tool_fingerprints SET initial_fingerprint = fingerprint WHERE initial_fingerprint IS NULL",
    );
  } catch {
    // Column already exists or table freshly created
  }
}
