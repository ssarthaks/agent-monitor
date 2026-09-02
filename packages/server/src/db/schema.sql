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

CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_action_id ON events(action_id);
CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
