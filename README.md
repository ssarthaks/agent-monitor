# Agent Monitor

> **Local-first activity monitor, deterministic policy gate, and real-time control plane for autonomous AI coding agents.**

[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](https://github.com/agentsentry/agentsentry)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Local-First](https://img.shields.io/badge/architecture-local--first-success.svg)](docs/architecture.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)

---

## What is Agent Monitor?

**Agent Monitor** is a local-first control plane and universal security boundary for autonomous AI coding agents and Model Context Protocol (MCP) clients. It intercepts agent actions and tool calls before execution, evaluates deterministic security risks and policies (`ALLOW`, `DENY`, `ASK`), enforces an authoritative local Kill Switch circuit breaker, verifies tool schema integrity against dynamic rug-pulls, records immutable audit events to an authoritative local SQLite database, and streams real-time telemetry to an embedded web dashboard and interactive terminal interface.

```text
┌─────────────────────────────────┐
│ AI Agent / MCP Client           │ (Claude Desktop, Cursor, DeepSeek, Custom Runtime)
└───────────────┬─────────────────┘
                │ 1. Tool Call Intent (stdio JSON-RPC or native runtime)
                ▼
┌─────────────────────────────────────────────────────────────┐
│             UNIVERSAL AGENT CONTROL BOUNDARY                │
│  (packages/agent ActionInterceptor OR packages/gateway Proxy)│
│                                                             │
│  2. Authoritative Kill Switch Check (Local Circuit Breaker) │
│  3. RFC 8089 URI & Workspace Guardrail Validation           │
│  4. Tool Schema Fingerprinting (Rug-Pull Mutation Detection)│
│  5. Behavioral Sequence Detection (Multi-Step Exfiltration) │
│  6. Deterministic Risk Assessment (0-100 CWE Score)         │
│  7. Additive Policy Evaluation (Match Specificity)          │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                      POLICY DECISION                        │
├─────────────────┬─────────────────────────┬─────────────────┤
│     ALLOW       │          ASK            │      DENY       │
│  Execute tool   │  Pause & Prompt Human   │ Block execution │
│   immediately   │  (Terminal or Web UI)   │  immediately    │
└────────┬────────┴────────────┬────────────┴────────┬────────┘
         │                     ▼                     │
         │          Human Approves / Denies          │
         │                     │                     │
         │         Post-Approval Kill Check          │
         ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 Authoritative SQLite Events                 │
│      (session.*, policy.evaluated, approval.*, action.*,    │
│       tool.discovered, tool.changed, behavioral.match)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ SSE (Server-Sent Events)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│         Web DevTools Control Plane (http://localhost:4040)  │
│  - Real-Time Action Stream   - Interactive Approval Modal   │
│  - Tool Integrity Matrix     - Behavioral Sequence Flow     │
│  - Unified File Diffs        - Process Output Inspection    │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Capabilities (V0.3 UNIVERSAL CONTROL BOUNDARY)

- 🛡️ **Deterministic Policy Engine:** Zero LLM heuristics. Strictly synchronous, rule-based policy evaluation with additive specificity scoring.
- 🚦 **Three-Tier Policy Decisions:**
  - **`ALLOW`:** Safe actions (workspace file reads, non-destructive test commands) execute immediately.
  - **`DENY`:** Dangerous actions (`.env` secrets, SSH keys, destructive root commands) are blocked immediately with zero tool execution.
  - **`ASK`:** Risky mutations (`git push`, `npm install`, network calls) pause agent execution until approved via the **Terminal** or **Web Dashboard**.
- 🛑 **Authoritative Local Kill Switch:** Instant SQLite-backed circuit breaker (`agent-monitor kill`) with pre- and post-approval checks to prevent race conditions.
- 🔌 **Universal MCP Stdio Gateway:** Transparent proxy for Claude Desktop, Cursor, and any MCP client/server without modifying application code.
- 🧬 **Tool Fingerprinting & Rug-Pull Detection:** Computes cryptographic SHA-256 fingerprints of discovered tools, flagging runtime mutation attempts before execution.
- 🌊 **Behavioral Sequence Correlator:** Detects complex multi-step attacks (e.g. sensitive credential reads followed by outbound network requests or shell execution).
- ⚡ **Human-in-the-Loop Approvals:** Approvals synchronize across terminal and browser with atomic SQLite conditional updates.
- 🔍 **Pre-Execution Risk Assessment:** Deterministic risk scoring (0–100) across 8 CWE vectors with RFC 8089 URI normalization and path traversal containment.
- 📦 **Local-First SQLite Persistence:** SQLite WAL mode with foreign keys ensures crash resilience and complete session replayability without cloud dependencies.
- 🖥️ **Embedded DevTools Dashboard:** Next.js control plane served directly by the monitor binary on port 4040.

---

## Quick Start

### 1. Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Package Manager**: `npm`, `pnpm`, or `yarn`
- **DeepSeek API Key** (for running the reference autonomous agent):
  ```bash
  export DEEPSEEK_API_KEY="sk-..."
  ```

### 2. Installation & Bootstrap

Clone the repository and build:

```bash
git clone https://github.com/agentsentry/agentsentry.git
cd agentsentry
npm install
npm run build
```

Initialize your workspace configuration:

```bash
npm run cli -- config init
```

This creates an [`agent-monitor.config.json`](docs/configuration.md) in your workspace root.

---

## Usage Guide

### 1. Simulate Policies (Dry-Run Check)

Test how the policy engine evaluates actions without running an agent or executing commands:

```bash
# Check git push (Triggers ASK)
npm run cli -- policy check --command "git push origin main"

# Check .env read (Triggers DENY)
npm run cli -- policy check --action file.read --path ".env"

# Check .env.sample read (Triggers ALLOW)
npm run cli -- policy check --action file.read --path ".env.sample"
```

### 2. Run an Autonomous Agent Task

Launch an agent with real-time policy interception and live monitoring:

```bash
npm run cli -- run --task "Inspect package.json and run npm test"
```

To run a task requiring human approval:

```bash
npm run cli -- run --task "Install lodash and update documentation" --keep-alive
```

When the agent attempts `npm install lodash`:

1. The Policy Engine triggers an **`ASK`** policy gate.
2. The agent execution pauses.
3. You can approve/deny by typing `y`/`n` in the terminal **or** clicking **Allow Once** in the browser at `http://localhost:4040`.

### 3. Transparent Model Context Protocol (MCP) Stdio Proxy

Wrap any external MCP server to enforce deterministic policies, tool schema fingerprinting, and runtime rug-pull detection:

```bash
# Intercept filesystem MCP server
npm run cli -- mcp proxy -- npx -y @modelcontextprotocol/server-filesystem /path/to/workspace
```

### 4. Authoritative Kill Switch Circuit Breaker

Instantly halt an active session across all tools and gateways:

```bash
# Activate kill switch
npm run cli -- kill --session <session-id> --reason "Suspicious activity detected"

# Resume session execution
npm run cli -- resume --session <session-id>
```

### 5. Inspect External Tools & Behavioral Flows

```bash
# Verify external tool fingerprints and mutation status
npm run cli -- tools --session <session-id>

# Inspect multi-step behavioral security flows (exfiltration detection)
npm run cli -- security flows --session <session-id>
```

### 6. Start the Standalone Web Dashboard

Explore recorded session logs, unified diffs, and inspect policies in the DevTools UI:

```bash
npm run cli -- server
```

Open **`http://localhost:4040`** in your browser.

---

## Monorepo Architecture

```text
agent-monitor/
├── packages/
│   ├── core/      # Domain schema, events, deterministic risk & policy engine, behavioral sequences
│   ├── server/    # SQLite WAL repository, EventBus, SSE & REST API, kill switch persistence
│   ├── agent/     # ActionInterceptor, Safe Tools, ApprovalManager, DeepSeek Runtime
│   ├── gateway/   # Universal MCP Stdio Proxy, tool fingerprinting, result inspection
│   └── cli/       # Command-line interface binary (`agent-monitor`)
├── apps/
│   └── web/       # Next.js 15 Alabaster/Ink/Burnt Terra Cotta DevTools Dashboard
└── docs/          # Comprehensive technical documentation
```

| Package                                                | Version | Description                                                                                                                        |
| :----------------------------------------------------- | :------ | :--------------------------------------------------------------------------------------------------------------------------------- |
| [`@agent-monitor/core`](packages/core/README.md)       | `0.3.0` | Pure domain types, action models, risk analyzer, policy engine, behavioral sequences, and tool fingerprinting (zero dependencies). |
| [`@agent-monitor/server`](packages/server/README.md)   | `0.3.0` | Local SQLite WAL persistence, authoritative kill switch circuit breaker, atomic approvals, SSE event stream, and REST endpoints.   |
| [`@agent-monitor/agent`](packages/agent/README.md)     | `0.3.0` | Security guardrails, safe tools, `ActionInterceptor`, approval manager, and reference DeepSeek coding agent.                       |
| [`@agent-monitor/gateway`](packages/gateway/README.md) | `0.3.0` | Universal Agent Control Boundary & transparent MCP stdio proxy with RFC 8089 URI normalization and tool rug-pull detection.        |
| [`@agent-monitor/cli`](packages/cli/README.md)         | `0.3.0` | Unified CLI binary (`run`, `server`, `policy check`, `mcp proxy`, `kill`, `resume`, `tools`, `security flows`, `config init`).     |
| [`@agent-monitor/web`](apps/web/README.md)             | `0.3.0` | Next.js DevTools dashboard for activity streams, diffs, tool integrity matrix, and approval modals.                                |

---

## Documentation Index

| Guide                                               | Description                                                                            |
| :-------------------------------------------------- | :------------------------------------------------------------------------------------- |
| 🚀 [**Getting Started**](docs/getting-started.md)   | Step-by-step onboarding from zero to your first monitored agent task.                  |
| 🏛️ [**Architecture**](docs/architecture.md)         | System components, data flows, SQLite event ordering, and package boundaries.          |
| 🛡️ [**Policies & Rules**](docs/policies.md)         | Deterministic specificity calculation, precedence rules, and custom policies.          |
| ⚙️ [**Configuration Guide**](docs/configuration.md) | Full `agent-monitor.config.json` specification and environment variable overrides.     |
| 🔒 [**Security Model**](docs/security.md)           | Guardrails, path traversal containment, symlink verification, and security boundaries. |
| ⚡ [**Actions Reference**](docs/actions.md)         | Action kinds (`file.read`, `file.write`, `process.exec`, `file.list`) and parameters.  |
| 📜 [**Events Reference**](docs/events.md)           | Complete schema of all 13 domain events and strict ordering guarantees.                |
| 🤖 [**Agent Runtime**](docs/agent-runtime.md)       | Decoupled runtime architecture, tool contracts, and DeepSeek client integration.       |
| 💻 [**CLI Manual**](docs/cli.md)                    | Complete CLI reference for all commands, options, and exit codes.                      |
| 🖥️ [**Dashboard Guide**](docs/dashboard.md)         | Activity stream filtering, unified diff viewer, and approval modal interface.          |
| 🛠️ [**Development**](docs/development.md)           | Setting up local workspaces, adding actions, extending risk rules, and contributing.   |
| 🧪 [**Testing Guide**](docs/testing.md)             | Test suites, policy unit tests, race condition verification, and coverage.             |
| ❓ [**Troubleshooting**](docs/troubleshooting.md)   | Common issues, port conflicts, API key setup, and resolution steps.                    |

---

## Testing & Quality

Run the complete test suite across all packages:

```bash
# Run all 111 Vitest tests across 18 test suites
npm test

# Type-check all packages
npx tsc --build packages/core packages/server packages/agent packages/gateway packages/cli
npx tsc --noEmit --project apps/web/tsconfig.json
```

---

## Roadmap

- **V0.1 (Complete):** Core Observation — Action interception, SQLite WAL logging, SSE streaming, Next.js DevTools dashboard.
- **V0.2 (Complete):** Observation + Control — Deterministic policy engine (`ALLOW`, `DENY`, `ASK`), human-in-the-loop approvals, dry-run simulator, configuration bootstrap.
- **V0.3 (Complete):** Universal Agent Control Boundary — Transparent MCP stdio proxy, authoritative local Kill Switch, tool fingerprinting & rug-pull mutation detection, behavioral sequence correlation.
- **V0.4 (Planned):** Distributed agent cluster monitoring, eBPF process isolation, remote policy sync.

---

## License

MIT © [Agent Monitor Contributors](LICENSE)
