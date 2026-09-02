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
```

---

## Installation

```bash
npm install -g @agent-monitor/cli
```
