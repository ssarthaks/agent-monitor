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
  check                 Alias for 'policy check'
  config init           Generate a starter agent-monitor.config.json file
  config validate       Validate syntax and rules of an agent-monitor.config.json file
  sessions              List recorded agent sessions from SQLite storage
  status                Show system status, SQLite storage size, and active configuration
  mcp proxy             Wrap an external MCP server process over stdio with deterministic controls
  kill                  Authoritatively activate the local Kill Switch circuit breaker for a session
  resume                Deactivate the Kill Switch and unblock session execution
  tools                 Inspect external tool fingerprints, baseline integrity, and mutation status
  security flows        Inspect detected behavioral data-flow sequences and multi-step exfiltration attempts
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
