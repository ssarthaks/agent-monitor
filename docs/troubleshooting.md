# Troubleshooting Guide

Common issues, diagnoses, and step-by-step solutions for Agent Monitor.

---

## 1. Missing API Key

**Symptoms:**

```text
❌ ERROR: DEEPSEEK_API_KEY is required to run the agent.
Please add DEEPSEEK_API_KEY to your .env or .env.local file, or export it in your shell.
```

**Solution:**
Export your DeepSeek API key in your terminal session or add it to your `.env` file:

```bash
export DEEPSEEK_API_KEY="sk-..."
```

_(Note: `agent-monitor policy check` and `agent-monitor server` do NOT require an API key)._

---

## 2. Port Already in Use (`EADDRINUSE`)

**Symptoms:**

```text
Error: listen EADDRINUSE: address already in use 127.0.0.1:4040
```

**Solution:**

1. Check what process is occupying port 4040:
   ```bash
   lsof -i :4040
   ```
2. Or specify a different port when running:
   ```bash
   agent-monitor run --task "..." --port 4050 --web-port 3001
   agent-monitor server --port 4050
   ```

---

## 3. Human Approval Prompt Closed Immediately / Auto-Denied

**Symptoms:**
Action is marked `BLOCKED` immediately upon hitting an `ASK` rule without prompting for input.

**Cause:**
Standard input (`process.stdin`) was not attached to an interactive TTY (e.g. running inside an automated task runner or non-interactive pipe) or received an immediate EOF.

**Solution:**

1. Run in an interactive terminal.
2. If running non-interactively, keep the dashboard open at `http://localhost:4040` and approve the action via the web UI.

---

## 4. SQLite Database Locked (`SQLITE_BUSY`)

**Symptoms:**

```text
SqliteError: database is locked
```

**Cause:**
Another process opened the SQLite database without WAL mode, or an external SQLite inspector has held an uncommitted write transaction.

**Solution:**
Agent Monitor automatically configures `PRAGMA journal_mode = WAL`. Close external database inspection GUIs (e.g. DB Browser for SQLite) if they hold locks on `.agent-monitor/data.db`.

---

## 5. Path Traversal Violation (`deny-outside-workspace`)

**Symptoms:**

```text
Security Violation: Action 'file.read' was blocked by policy: File operations outside the designated workspace root are prohibited.
```

**Cause:**
The agent attempted to access a file path that resolves outside the designated `workspaceRoot` directory (e.g. `/etc/hosts` or `../../secret.txt`).

**Solution:**
Ensure all targeted files reside within the workspace directory, or pass `--workspace /path/to/project` to adjust the root containment boundary.
