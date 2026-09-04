import { Database } from "better-sqlite3";
import { Migration } from "./types.js";

export const MIGRATIONS: Migration[] = [
  {
    id: "001_initial",
    name: "Base sessions, events, and approvals",
    up: (db: Database) => {
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
          hash TEXT,
          prev_hash TEXT,
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
      `);

      // Ensure hash and prev_hash exist if events table already existed
      try {
        db.exec("ALTER TABLE events ADD COLUMN hash TEXT");
      } catch {}
      try {
        db.exec("ALTER TABLE events ADD COLUMN prev_hash TEXT");
      } catch {}
    },
  },
  {
    id: "002_v03_controls",
    name: "Tool fingerprints, behavioral matches, and control state",
    up: (db: Database) => {
      db.exec(`
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
      `);

      try {
        db.exec(
          "ALTER TABLE tool_fingerprints ADD COLUMN initial_fingerprint TEXT",
        );
        db.exec(
          "UPDATE tool_fingerprints SET initial_fingerprint = fingerprint WHERE initial_fingerprint IS NULL",
        );
      } catch {}
    },
  },
  {
    id: "003_v40_policy_versions",
    name: "Policy versioning, history, and audit log",
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS policy_versions (
          id TEXT PRIMARY KEY,
          version_number INTEGER NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT,
          rules_json TEXT NOT NULL,
          default_decision TEXT NOT NULL CHECK(default_decision IN ('ALLOW', 'DENY', 'ASK')),
          timeout_ms INTEGER NOT NULL DEFAULT 300000,
          is_active INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          created_by TEXT NOT NULL,
          change_summary TEXT,
          hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS policy_audit_log (
          id TEXT PRIMARY KEY,
          version_id TEXT,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          details_json TEXT NOT NULL
        );
      `);
    },
  },
  {
    id: "004_v40_incidents",
    name: "Security incidents case management",
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS incidents (
          id TEXT PRIMARY KEY,
          incident_number TEXT NOT NULL UNIQUE,
          session_id TEXT NOT NULL,
          severity TEXT NOT NULL CHECK(severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
          status TEXT NOT NULL CHECK(status IN ('OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'FALSE_POSITIVE')),
          trigger_type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          trigger_event_id TEXT,
          related_event_ids_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          resolved_at INTEGER,
          resolved_by TEXT,
          resolution_notes TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: "005_v40_mcp_sources",
    name: "MCP source management and quarantine registry",
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mcp_sources (
          source_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          command TEXT NOT NULL,
          args_json TEXT NOT NULL,
          env_json TEXT,
          cwd TEXT,
          status TEXT NOT NULL CHECK(status IN ('HEALTHY', 'DEGRADED', 'QUARANTINED', 'STOPPED', 'CRASHED')),
          pid INTEGER,
          start_time INTEGER,
          restart_count INTEGER NOT NULL DEFAULT 0,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          last_seen INTEGER NOT NULL,
          tool_count INTEGER NOT NULL DEFAULT 0,
          quarantined_at INTEGER,
          quarantined_by TEXT,
          quarantine_reason TEXT,
          trust_state TEXT NOT NULL CHECK(trust_state IN ('TRUSTED', 'UNTRUSTED', 'PROBATION')) DEFAULT 'TRUSTED'
        );
      `);
    },
  },
  {
    id: "006_v40_idempotency_and_indexes",
    name: "Idempotency records and performance indexes",
    up: (db: Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS idempotency_records (
          key TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          action_kind TEXT NOT NULL,
          request_params_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          result_json TEXT
        );

        -- Performance Indexes
        CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_events_action_id ON events(action_id);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON events(type, timestamp);
        CREATE INDEX IF NOT EXISTS idx_events_risk_level ON events(risk_level);
        CREATE INDEX IF NOT EXISTS idx_events_action_kind ON events(action_kind);

        CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id, status);
        CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

        CREATE INDEX IF NOT EXISTS idx_tool_fingerprints_session ON tool_fingerprints(session_id, tool_name, source);
        CREATE INDEX IF NOT EXISTS idx_behavioral_matches_session ON behavioral_matches(session_id);

        CREATE INDEX IF NOT EXISTS idx_incidents_session_status ON incidents(session_id, status);
        CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_incidents_number ON incidents(incident_number);

        CREATE INDEX IF NOT EXISTS idx_mcp_sources_status ON mcp_sources(status);
        CREATE INDEX IF NOT EXISTS idx_mcp_sources_trust ON mcp_sources(trust_state);

        CREATE INDEX IF NOT EXISTS idx_policy_versions_active ON policy_versions(is_active);
        CREATE INDEX IF NOT EXISTS idx_policy_versions_number ON policy_versions(version_number);

        CREATE INDEX IF NOT EXISTS idx_idempotency_session ON idempotency_records(session_id);
      `);
    },
  },
  {
    id: "007_v41_production_hardening",
    name: "Approval context binding, expiration, and MCP source fingerprinting",
    up: (db: Database) => {
      try {
        db.exec(
          "ALTER TABLE approvals ADD COLUMN policy_version INTEGER DEFAULT 1",
        );
      } catch {}
      try {
        db.exec("ALTER TABLE approvals ADD COLUMN expires_at INTEGER");
      } catch {}
      try {
        db.exec("ALTER TABLE approvals ADD COLUMN action_context_hash TEXT");
      } catch {}

      try {
        db.exec(
          "ALTER TABLE mcp_sources ADD COLUMN transport TEXT DEFAULT 'stdio'",
        );
      } catch {}
      try {
        db.exec("ALTER TABLE mcp_sources ADD COLUMN fingerprint TEXT");
      } catch {}
      try {
        db.exec(
          "ALTER TABLE mcp_sources ADD COLUMN tool_schema_fingerprint TEXT",
        );
      } catch {}
      try {
        db.exec(
          "ALTER TABLE mcp_sources ADD COLUMN retrust_required INTEGER DEFAULT 0",
        );
      } catch {}

      try {
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_approvals_expires_status ON approvals(status, expires_at)",
        );
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_approvals_context_hash ON approvals(action_context_hash)",
        );
      } catch {}
    },
  },
];
