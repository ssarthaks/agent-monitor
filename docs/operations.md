# Production Operations Guide (V4.1.0)

This guide covers operational requirements, database maintenance, sizing, monitoring, and production deployment of **Agent Monitor**.

---

## 1. Authoritative Persistence Architecture

Agent Monitor relies solely on **SQLite with Write-Ahead Logging (WAL)** as its authoritative persistence layer.

### Core SQLite Configuration
- **`journal_mode = WAL`**: Enables high-concurrency readers alongside a writer without lock contention.
- **`synchronous = NORMAL`**: Guarantees crash safety while minimizing disk I/O bottlenecks.
- **`busy_timeout = 5000`**: 5000ms retry window preventing `SQLITE_BUSY` errors during burst writes.
- **`foreign_keys = ON`**: Enforces relational consistency across sessions, events, approvals, and incidents.

---

## 2. Health & Integrity Diagnostics

Run comprehensive system diagnostics to check SQLite health, page metrics, WAL status, and server state:

```bash
agent-monitor health
```

Pure JSON format for Prometheus/Datadog exporters or Nagios health checks:

```bash
agent-monitor health --json
```

Example response:
```json
{
  "status": "healthy",
  "database": {
    "status": "ok",
    "journalMode": "wal",
    "foreignKeys": true,
    "busyTimeout": 5000,
    "pageSize": 4096,
    "pageCount": 314,
    "integrityCheck": "ok",
    "quickCheck": "ok",
    "migrationsVersion": 7,
    "checkedAt": 1788535809329
  },
  "server": {
    "running": true,
    "port": 4040
  },
  "workspace": "/app",
  "timestamp": 1788535809333,
  "version": "4.1.0"
}
```

---

## 3. SQLite Database Maintenance

### 3.1 Checkpoints & WAL Compaction
During graceful shutdown, the monitor server automatically checkpoints and truncates the WAL:
```sql
PRAGMA wal_checkpoint(TRUNCATE);
```

To run an explicit manual checkpoint:
```bash
sqlite3 .agent-monitor/data.db "PRAGMA wal_checkpoint(FULL);"
```

### 3.2 Hot Backups
SQLite WAL mode supports online zero-downtime hot backups using SQLite's backup API:
```bash
sqlite3 .agent-monitor/data.db ".backup .agent-monitor/data-backup.db"
```

### 3.3 Database Integrity Validation
Always verify database page consistency before and after backups:
```bash
sqlite3 .agent-monitor/data.db "PRAGMA integrity_check;"
```

---

## 4. Server Deployment

### Running the Monitor Server as a Daemon
Deploy the monitor server behind a systemd service, launchd daemon, or container:

```bash
agent-monitor server --port 4040 --host 0.0.0.0
```

### Environment Variables
| Variable | Description | Default |
|---|---|---|
| `AGENT_MONITOR_DB` | Custom path to SQLite database file | `<workspace>/.agent-monitor/data.db` |
| `AGENT_MONITOR_PORT` | Port for REST / SSE server and DevTools UI | `4040` |
| `AGENT_MONITOR_HOST` | Host binding for server | `127.0.0.1` |
| `AGENT_MONITOR_CONFIG` | Path to policy configuration file | `<workspace>/agent-monitor.config.json` |
| `DEEPSEEK_API_KEY` | API key for built-in DeepSeek agent runner | None |
