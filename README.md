# Agent Monitor

> **Local-first activity monitor, deterministic policy gate, and real-time control plane for autonomous AI coding agents.**

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/agentsentry/agentsentry)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Local-First](https://img.shields.io/badge/architecture-local--first-success.svg)](docs/architecture.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)

---

## What is Agent Monitor?

**Agent Monitor** is a local-first control plane and developer activity monitor for autonomous AI coding agents. It intercepts agent actions before execution, evaluates deterministic security risks and policies (`ALLOW`, `DENY`, `ASK`), records immutable audit events to an authoritative local SQLite database, and streams real-time telemetry to an embedded web dashboard and interactive terminal interface.

```text
┌─────────────────┐
│   AI Agent      │ (Autonomous LLM Runtime)
└────────┬────────┘
         │ 1. Tool Call Intent (params)
         ▼
┌─────────────────┐
│ Action          │ 2. Guardrails & Workspace Containment
│ Interceptor     │ 3. Deterministic Risk Assessment (0-100)
└────────┬────────┘
         │ 4. Policy Engine Evaluation
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
         ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 Authoritative SQLite Events                 │
│      (session.*, policy.evaluated, approval.*, action.*)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ SSE (Server-Sent Events)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│         Web DevTools Control Plane (http://localhost:4040)  │
│  - Real-Time Action Stream   - Interactive Approval Modal   │
│  - Unified File Diffs        - Process Output Inspection    │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Capabilities (V0.2 OBSERVE + CONTROL)

* 🛡️ **Deterministic Policy Engine:** Zero LLM heuristics. Strictly synchronous, rule-based policy evaluation with additive specificity scoring.
* 🚦 **Three-Tier Policy Decisions:**
  * **`ALLOW`:** Safe actions (workspace file reads, non-destructive test commands) execute immediately.
  * **`DENY`:** Dangerous actions (`.env` secrets, SSH keys, destructive root commands) are blocked immediately with zero tool execution.
  * **`ASK`:** Risky mutations (`git push`, `npm install`) pause agent execution until approved via the **Terminal** or **Web Dashboard**.
* ⚡ **Human-in-the-Loop Approvals:** Approvals synchronize across terminal and browser. Atomic SQLite conditional updates eliminate race conditions.
* 🔍 **Pre-Execution Risk Assessment:** Calculates deterministic risk scores (0–100) across 8 CWE security vectors (dotenv access, SSH keys, destructive deletions, privilege escalation, outbound network, path traversal).
* 📦 **Local-First SQLite Persistence:** SQLite WAL mode with foreign keys ensures crash resilience and complete session replayability without cloud dependencies.
* 🖥️ **Embedded DevTools Dashboard:** Next.js control plane served directly by the monitor binary on port 4040.
* 🔌 **Provider-Agnostic Core:** `@agent-monitor/core` has zero LLM dependencies. Reference DeepSeek runtime is strictly decoupled in `@agent-monitor/agent`.

---

## Quick Start

### 1. Prerequisites

* **Node.js**: `v20.0.0` or higher
* **Package Manager**: `npm`, `pnpm`, or `yarn`
* **DeepSeek API Key** (for running the reference autonomous agent):
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

### 3. Start the Standalone Web Dashboard

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
│   ├── core/      # Domain schema, events, deterministic risk & policy engine
│   ├── server/    # SQLite WAL repository, EventBus, SSE & REST API
│   ├── agent/     # ActionInterceptor, Safe Tools, ApprovalManager, DeepSeek Runtime
│   └── cli/       # Command-line interface binary (`agent-monitor`)
├── apps/
│   └── web/       # Next.js 15 Alabaster/Ink/Burnt Terra Cotta DevTools Dashboard
└── docs/          # Comprehensive technical documentation
```

| Package | Version | Description |
| :--- | :--- | :--- |
| [`@agent-monitor/core`](packages/core/README.md) | `0.2.0` | Pure domain types, action models, risk analyzer, and policy engine (zero external dependencies). |
| [`@agent-monitor/server`](packages/server/README.md) | `0.2.0` | Local SQLite WAL persistence, atomic approval resolution, SSE event stream, and REST endpoints. |
| [`@agent-monitor/agent`](packages/agent/README.md) | `0.2.0` | Security guardrails, tool definitions, `ActionInterceptor`, and reference DeepSeek coding agent. |
| [`@agent-monitor/cli`](packages/cli/README.md) | `0.2.0` | Unified CLI binary (`run`, `server`, `policy check`, `config init`, `sessions`, `status`). |
| [`@agent-monitor/web`](apps/web/README.md) | `0.2.0` | Next.js DevTools dashboard for activity streams, diffs, and approval modals. |

---

## Documentation Index

| Guide | Description |
| :--- | :--- |
| 🚀 [**Getting Started**](docs/getting-started.md) | Step-by-step onboarding from zero to your first monitored agent task. |
| 🏛️ [**Architecture**](docs/architecture.md) | System components, data flows, SQLite event ordering, and package boundaries. |
| 🛡️ [**Policies & Rules**](docs/policies.md) | Deterministic specificity calculation, precedence rules, and custom policies. |
| ⚙️ [**Configuration Guide**](docs/configuration.md) | Full `agent-monitor.config.json` specification and environment variable overrides. |
| 🔒 [**Security Model**](docs/security.md) | Guardrails, path traversal containment, symlink verification, and security boundaries. |
| ⚡ [**Actions Reference**](docs/actions.md) | Action kinds (`file.read`, `file.write`, `process.exec`, `file.list`) and parameters. |
| 📜 [**Events Reference**](docs/events.md) | Complete schema of all 10 domain events and strict ordering guarantees. |
| 🤖 [**Agent Runtime**](docs/agent-runtime.md) | Decoupled runtime architecture, tool contracts, and DeepSeek client integration. |
| 💻 [**CLI Manual**](docs/cli.md) | Complete CLI reference for all commands, options, and exit codes. |
| 🖥️ [**Dashboard Guide**](docs/dashboard.md) | Activity stream filtering, unified diff viewer, and approval modal interface. |
| 🛠️ [**Development**](docs/development.md) | Setting up local workspaces, adding actions, extending risk rules, and contributing. |
| 🧪 [**Testing Guide**](docs/testing.md) | Test suites, policy unit tests, race condition verification, and coverage. |
| ❓ [**Troubleshooting**](docs/troubleshooting.md) | Common issues, port conflicts, API key setup, and resolution steps. |

---

## Testing & Quality

Run the complete test suite across all packages:

```bash
# Run all 50+ Vitest tests
npm test

# Type-check all packages
npx tsc --build packages/core packages/server packages/agent packages/cli
npx tsc --noEmit --project apps/web/tsconfig.json
```

---

## Roadmap

* **V0.1 (Complete):** Core Observation — Action interception, SQLite WAL logging, SSE streaming, Next.js DevTools dashboard.
* **V0.2 (Current):** Observation + Control — Deterministic policy engine (`ALLOW`, `DENY`, `ASK`), human-in-the-loop approvals, dry-run simulator, configuration bootstrap.
* **V0.3 (Planned):** Extended tool sandboxing, interactive policy rule builder, enhanced session export formats.

---

## License

MIT © [Agent Monitor Contributors](LICENSE)
