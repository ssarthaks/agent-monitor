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
