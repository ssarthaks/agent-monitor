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

# 3. Bootstrap configuration file
agent-monitor config init

# 4. Validate configuration syntax and rules
agent-monitor config validate

# 5. List recorded sessions
agent-monitor sessions

# 6. Show system status and database storage
agent-monitor status

# 7. Start standalone Monitor Server & Web Dashboard
agent-monitor server

# 8. Run transparent MCP stdio proxy with deterministic security boundary
agent-monitor mcp proxy -- npx -y @modelcontextprotocol/server-filesystem /tmp

# 9. Activate authoritative local Kill Switch circuit breaker
agent-monitor kill --session <session-id> --reason "Operator manual abort"

# 10. Deactivate Kill Switch and resume session execution
agent-monitor resume --session <session-id>

# 11. Inspect external tool fingerprints and mutation status (rug-pull detection)
agent-monitor tools --session <session-id>

# 12. Inspect behavioral data flows and security sequence violations
agent-monitor security flows --session <session-id>
```

---

## Installation

```bash
npm install -g @agent-monitor/cli
```
