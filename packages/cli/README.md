# `@agent-monitor/cli`

Unified command-line interface for Agent Monitor.

---

## Overview

`@agent-monitor/cli` provides the `agent-monitor` CLI binary for running autonomous agent tasks, simulating policies, initializing configurations, listing session history, and starting the DevTools server.

---

## Commands

```bash
# 1. Run agent task with real-time policy monitoring
agent-monitor run --task "Inspect repository and run tests"

# 2. Simulate policy evaluation (Dry Run)
agent-monitor policy check --command "git push origin main"

# 3. Policy versioning & instant rollback
agent-monitor policy versions
agent-monitor policy diff 1 2
agent-monitor policy rollback 1
agent-monitor policy disable ask-npm-install

# 4. Security incidents case management
agent-monitor incidents list --status OPEN --severity CRITICAL
agent-monitor incidents show <incident-id>
agent-monitor incidents update <incident-id> --status CONTAINED
agent-monitor incidents events <incident-id>

# 5. MCP source quarantine & trust lifecycle
agent-monitor mcp list
agent-monitor mcp quarantine <source-id> --reason "Schema mutation"
agent-monitor mcp trust <source-id>

# 6. Cryptographic audit log verification
agent-monitor audit verify

# 7. Raw event log queries
agent-monitor events --type action.blocked --limit 20

# 8. Machine-readable JSON output for CI / SIEM
agent-monitor incidents list --json
agent-monitor audit verify --json

# 9. Bootstrap configuration file
agent-monitor config init

# 10. Start standalone Monitor Server & Web Dashboard
agent-monitor server

# 11. Run transparent MCP stdio proxy with deterministic controls
agent-monitor mcp proxy -- npx -y @modelcontextprotocol/server-filesystem /tmp

# 12. Authoritative Kill Switch circuit breaker
agent-monitor kill --session <session-id> --reason "Operator manual abort"
agent-monitor resume --session <session-id>

# 13. Inspect external tool fingerprints and mutation status
agent-monitor tools --session <session-id>

# 14. Inspect behavioral data flows and security sequence violations
agent-monitor security flows --session <session-id>
```

---

## Installation

```bash
npm install -g @agent-monitor/cli
```
