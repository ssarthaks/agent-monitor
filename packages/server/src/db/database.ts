import DatabaseConstructor, { Database } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function createDatabase(dbPath: string = ':memory:'): Database {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseConstructor(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'interrupted')),
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

    CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_events_action_id ON events(action_id);
  `);
}
