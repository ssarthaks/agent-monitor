# CLI Command Reference (`agent-monitor`)

`agent-monitor` is the unified command-line tool for orchestrating agents, simulating policies, bootstrapping configurations, and hosting the embedded DevTools control plane.

---

## Command Overview

```text
agent-monitor [command] [options]

Commands:
  run                   Run an autonomous coding agent with real-time monitoring and policy gating
  server                Start the standalone Monitor Server and embedded DevTools Web UI
  policy check          Simulate policy evaluation on a target action/command (Dry Run)
  policy versions       List all recorded policy versions and active version
  policy rollback       Rollback active security policy to a historical version
  policy enable         Enable a policy rule by ID
  policy disable        Disable a policy rule by ID without deleting it
  policy diff           Compute visual or JSON diff between two policy versions
  policy history        Show policy mutation and change audit history
  policy validate       Validate policy rules against safety schema, rule bounds, and consistency
  health                Run comprehensive system, database integrity, and server health diagnostics
  config init           Generate a starter agent-monitor.config.json file
  config validate       Validate syntax and rules of an agent-monitor.config.json file
  sessions              List recorded agent sessions from SQLite storage
  status                Show system status, SQLite storage size, and active configuration
  mcp proxy             Wrap an external MCP server process over stdio with deterministic controls
  mcp list              List registered downstream MCP server sources and health status
  mcp show              Show detailed runtime and quarantine status for an MCP source
  mcp quarantine        Quarantine an untrusted or compromised MCP source immediately
  mcp trust             Trust and lift quarantine on an MCP source
  kill                  Authoritatively activate the local Kill Switch circuit breaker for a session
  resume                Deactivate the Kill Switch and unblock session execution
  tools                 Inspect external tool fingerprints, baseline integrity, and mutation status
  security flows        Inspect detected behavioral data-flow sequences and multi-step exfiltration attempts
  incidents [list]      List security incidents recorded by the control plane
  incidents show        Show detailed security incident information
  incidents update      Update security incident status or resolution notes
  incidents events      List audit events tied to a security incident
  audit verify          Verify SHA-256 hash chaining of audit events across sessions
  audit export          Export deterministic canonical audit ledger with verification report
  events                Inspect chronological event log stream with filtering
```

---

## 1. `agent-monitor run`

Run an autonomous AI coding agent with active interception and deterministic policy enforcement.

```bash
agent-monitor run --task "<task>" [options]
```

### Options

- `-t, --task <string>` **(Required)**: The task or prompt for the agent to execute.
- `-w, --workspace <path>`: Workspace root path (defaults to current working directory).
- `-p, --port <number>`: Monitor Server API port (default: `4040`).
- `--web-port <number>`: Web Dashboard port (default: `3000`).
- `--model <string>`: DeepSeek model name (default: `deepseek-chat`).
- `--db <path>`: Custom SQLite database file path.
- `-c, --config <path>`: Custom path to `agent-monitor.config.json`.
- `--keep-alive`: Keep the monitor server running after the agent task completes.

### Examples

```bash
# Basic monitored run
agent-monitor run --task "Inspect repository and summarize architecture"

# Run with custom config and keep server alive
agent-monitor run --task "Refactor login validation" --config ./custom.json --keep-alive
```

---

## 2. `agent-monitor server`

Start the standalone Monitor Server to serve SQLite session history, embedded DevTools UI, and live SSE streaming.

```bash
agent-monitor server [options]
```

### Options

- `-p, --port <number>`: Server listening port (default: `4040`).
- `-w, --workspace <path>`: Workspace directory (default: `process.cwd()`).
- `--db <path>`: Custom SQLite database path.

### Examples

```bash
# Start server on default port 4040
agent-monitor server

# Start server on custom port
agent-monitor server --port 8080
```

---

## 3. `agent-monitor policy check` (or `agent-monitor check`)

Simulate policy evaluation on an action or command without executing it (Dry Run).

```bash
agent-monitor policy check [options]
```

### Options

- `-a, --action <string>`: Action kind (e.g. `process.exec`, `file.read`, `file.write`, `file.list`, default: `process.exec`).
- `-c, --command <string>`: Target command to evaluate.
- `-p, --path <string>`: Target file path to evaluate.
- `-w, --workspace <path>`: Workspace root path.
- `--config <path>`: Custom configuration path.

### Examples

```bash
# Test shell command
agent-monitor policy check --command "git push origin main"

# Test file read
agent-monitor policy check --action file.read --path ".env"

# Test file write to nested docs
agent-monitor policy check --action file.write --path "docs/readme.md"
```

---

## 4. `agent-monitor config init`

Bootstrap an `agent-monitor.config.json` in your current directory.

```bash
agent-monitor config init [options]
```

### Options

- `-w, --workspace <path>`: Target workspace directory.
- `-f, --force`: Overwrite existing configuration file if present.

---

## 5. `agent-monitor config validate`

Validate the syntax and rule structure of an existing configuration.

```bash
agent-monitor config validate [path]
```

### Examples

```bash
# Validate default ./agent-monitor.config.json
agent-monitor config validate

# Validate custom file
agent-monitor config validate ./config/staging.json
```

---

## 6. `agent-monitor sessions`

List recorded sessions stored in the SQLite database.

```bash
agent-monitor sessions [options]
```

### Options

- `-w, --workspace <path>`: Workspace directory.
- `--db <path>`: Custom database path.
- `-n, --limit <number>`: Number of sessions to display (default: `20`).

---

## 7. `agent-monitor status`

Inspect current workspace status, database size, and check if a background server is active.

```bash
agent-monitor status [options]
```

---

## 8. `agent-monitor mcp proxy`

Wrap an external Model Context Protocol (MCP) server process over stdio with deterministic policy enforcement, RFC 8089 URI normalization, and runtime tool fingerprinting.

```bash
agent-monitor mcp proxy [options] -- <command...>
```

### Options

- `<command...>` **(Required)**: Downstream command and arguments to execute (e.g. `npx -y @modelcontextprotocol/server-filesystem /tmp`).
- `-w, --workspace <path>`: Workspace directory root.
- `-s, --session <id>`: Session ID to associate or resume.
- `--server-name <name>`: Descriptive identifier for the downstream MCP server (e.g. `filesystem`).
- `-p, --port <port>`: Monitor Server port (default: `4040`).
- `--db <path>`: Custom SQLite database file path.
- `-c, --config <path>`: Custom path to `agent-monitor.config.json`.
- `--no-server`: Disable background HTTP/SSE server for this proxy session.

### Example

```bash
# Wrap an MCP filesystem server inside your project root
agent-monitor mcp proxy --server-name filesystem -- npx -y @modelcontextprotocol/server-filesystem ./workspace
```

---

## 9. `agent-monitor kill`

Activate the authoritative local circuit breaker / Kill Switch for an active agent session in SQLite storage, terminating all ongoing and future tool executions immediately.

```bash
agent-monitor kill [options]
```

### Options

- `-s, --session <id>`: Target session ID (defaults to active session).
- `-r, --reason <reason>`: Explanation for activating the kill switch.
- `-w, --workspace <path>`: Workspace directory.
- `--db <path>`: Custom SQLite database file path.
- `-p, --port <port>`: Monitor Server port to notify (default: `4040`).

### Example

```bash
agent-monitor kill --session ses_prod_01 --reason "Unauthorized directory traversal detected"
```

---

## 10. `agent-monitor resume`

Deactivate the local Kill Switch for an agent session in SQLite storage and unblock execution.

```bash
agent-monitor resume [options]
```

### Options

- `-s, --session <id>`: Target session ID (defaults to active session).
- `-w, --workspace <path>`: Workspace directory.
- `--db <path>`: Custom SQLite database file path.
- `-p, --port <port>`: Monitor Server port to notify (default: `4040`).

### Example

```bash
agent-monitor resume --session ses_prod_01
```

---

## 11. `agent-monitor tools`

Inspect external tool fingerprints discovered across agent sessions, verifying schema integrity and detecting runtime mutation (rug-pull) attacks.

```bash
agent-monitor tools [options]
```

### Options

- `-s, --session <id>`: Target session ID.
- `-w, --workspace <path>`: Workspace directory.
- `--db <path>`: Custom SQLite database file path.
- `-p, --port <port>`: Monitor Server port to query (default: `4040`).

### Example

```bash
agent-monitor tools --session ses_prod_01
```

---

## 12. `agent-monitor security flows`

Inspect detected multi-step behavioral security sequences and data-flow anomalies (e.g. reading sensitive `.env` credentials followed by an outbound network call).

```bash
agent-monitor security flows [options]
```

### Options

- `-s, --session <id>`: Target session ID.
- `-w, --workspace <path>`: Workspace directory.
- `--db <path>`: Custom SQLite database file path.
- `-p, --port <port>`: Monitor Server port to query (default: `4040`).

### Example

```bash
agent-monitor security flows --session ses_prod_01
```

---

## 13. Policy Versioning & Management (`agent-monitor policy ...`)

Inspect, toggle, diff, and roll back immutable policy versions stored with SHA-256 integrity hashes in SQLite.

### `agent-monitor policy versions`

List all recorded policy versions and identify the currently active policy:

```bash
agent-monitor policy versions [--json]
```

### `agent-monitor policy rollback <versionId>`

Roll back the active policy configuration to a previous version:

```bash
agent-monitor policy rollback 1 [--json]
```

### `agent-monitor policy enable <ruleId>` & `disable <ruleId>`

Toggle an individual rule on or off in the active policy without manually editing configuration files. Each toggle atomically creates a new version:

```bash
# Disable a noisy rule
agent-monitor policy disable ask-npm-install

# Re-enable the rule
agent-monitor policy enable ask-npm-install
```

### `agent-monitor policy diff <versionA> <versionB>`

Compute visual or JSON diff between two policy versions:

```bash
agent-monitor policy diff 1 2 [--json]
```

### `agent-monitor policy history`

Display the complete mutation and activation audit trail for policy versions:

```bash
agent-monitor policy history [--json]
```

---

## 14. Incident Operations (`agent-monitor incidents ...`)

Manage and investigate security incidents automatically or manually filed by the control plane.

### `agent-monitor incidents [list]`

List security incidents with optional filtering by status and severity:

```bash
agent-monitor incidents list [options]
```

#### Options:
- `-s, --session <id>`: Filter by session ID.
- `--status <status>`: Filter by status (`OPEN`, `INVESTIGATING`, `CONTAINED`, `RESOLVED`, `FALSE_POSITIVE`).
- `--severity <severity>`: Filter by severity (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`).
- `--json`: Output pure machine-readable JSON format.

### `agent-monitor incidents show <id>`

Display detailed incident diagnostics, root cause indicators, and metadata:

```bash
agent-monitor incidents show inc_123 [--json]
```

### `agent-monitor incidents update <id>`

Transition an incident's triage lifecycle state, adjust severity, or attach investigation notes:

```bash
agent-monitor incidents update inc_123 --status CONTAINED --notes "Host isolated, credentials rotated"
```

### `agent-monitor incidents events <id>`

List correlated chronological audit events that triggered or relate to the incident:

```bash
agent-monitor incidents events inc_123 [--json]
```

---

## 15. MCP Source Management (`agent-monitor mcp ...`)

Manage connected downstream Model Context Protocol servers and enforce sticky quarantine isolation.

### `agent-monitor mcp list`

List registered MCP server sources, tool counts, error counts, and health status (`HEALTHY` / `QUARANTINED`):

```bash
agent-monitor mcp list [--json]
```

### `agent-monitor mcp show <sourceId>`

Show comprehensive runtime diagnostics, execution metrics, and quarantine reason:

```bash
agent-monitor mcp show mcp:filesystem [--json]
```

### `agent-monitor mcp quarantine <sourceId> --reason <reason>`

Quarantine an untrusted, compromised, or mutating MCP server. Quarantine status is sticky and persists across server restarts until explicitly trusted:

```bash
agent-monitor mcp quarantine mcp:filesystem --reason "Tool schema mutation attempted"
```

### `agent-monitor mcp trust <sourceId>`

Lift quarantine status and restore execution trust for an MCP source:

```bash
agent-monitor mcp trust mcp:filesystem
```

---

## 16. Cryptographic Audit Verification (`agent-monitor audit verify`)

Verify the SHA-256 cryptographic hash chaining of all historical events in SQLite to detect tampering or record manipulation:

```bash
agent-monitor audit verify [options]
```

### Options:
- `-s, --session <id>`: Target session ID (verifies all sessions across SQLite if omitted).
- `--json`: Output pure machine-readable JSON format.

### Example Output:
```text
✓ Audit log integrity verified across 42 event(s). Zero tamper anomalies detected.
```

---

## 17. Chronological Event Stream (`agent-monitor events`)

Query and filter raw domain events recorded by the control plane:

```bash
agent-monitor events [options]
```

### Options:
- `-s, --session <id>`: Filter by session ID.
- `-t, --type <type>`: Filter by event type (e.g. `action.blocked`, `incident.created`, `tool.changed`).
- `-n, --limit <count>`: Maximum number of events to show (default: 50).
- `--json`: Output pure machine-readable JSON format.

---

## 18. Machine-Readable JSON Mode (`--json`)

Every query and operations command in Agent Monitor supports the `--json` flag. When provided, human-oriented formatting (ASCII banners, chalk colors, box drawings) is suppressed, and pure machine-parseable JSON is written directly to standard output:

```bash
# Query open critical incidents in JSON for SIEM ingestion:
agent-monitor incidents list --status OPEN --severity CRITICAL --json | jq '.[].id'

# Automate policy version verification in CI:
agent-monitor audit verify --json | jq '.valid'
```

---

## 19. System & Database Health (`agent-monitor health`)

Run comprehensive system, SQLite database page integrity, WAL configuration, and server health diagnostics:

```bash
agent-monitor health [options]
```

### Options:
- `--json`: Output pure machine-readable JSON format.

### Example Output:
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

## 20. Canonical Audit Export (`agent-monitor audit export`)

Export deterministic, canonical JSON ledgers of historical event chains with verification reports:

```bash
agent-monitor audit export [options]
```

### Options:
- `-s, --session <id>`: Target session ID (exports all sessions if omitted).
- `-o, --output <path>`: Write ledger export to target file path instead of stdout.
- `--json`: Output pure machine-readable JSON format.

---

## 21. Standard Process Exit Codes

All `agent-monitor` CLI commands strictly conform to the following POSIX exit codes:

| Exit Code | Classification | Meaning |
|---|---|---|
| `0` | `SUCCESS` | Command completed successfully and checks passed. |
| `1` | `FAILURE` | Operational, network, database connection, or runtime execution error. |
| `2` | `INVALID_INPUT` | Command-line argument syntax error, invalid policy schema, or rule bounds exceeded. |
| `3` | `TAMPER_DETECTED` | Cryptographic audit trail verification failed (hash chain broken or data tampered). |

