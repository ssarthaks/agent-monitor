# Agent Monitor

> **Production Control Plane, Deterministic Policy Gate, and Security Operations for Autonomous AI Coding Agents.**

[![Version](https://img.shields.io/badge/version-4.1.0-blue.svg)](https://github.com/agentsentry/agentsentry)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Local-First](https://img.shields.io/badge/architecture-local--first-success.svg)](docs/architecture.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-186%20passed-brightgreen.svg)](docs/adversarial-testing.md)

---

## What is Agent Monitor?

**Agent Monitor** is a local-first production control plane, universal security boundary, and security operations center for autonomous AI coding agents and Model Context Protocol (MCP) clients. It intercepts agent actions and tool calls before execution, evaluates deterministic security risks and versioned policies (`ALLOW`, `DENY`, `ASK`), enforces an authoritative local Kill Switch circuit breaker, isolates and quarantines untrusted MCP sources, verifies tool schema integrity against dynamic rug-pulls, inspects tool outputs for sensitive credential leaks, records tamper-evident SHA-256 hash-chained audit events to an authoritative local SQLite database, automatically creates security incident cases, and streams real-time telemetry to an embedded web dashboard and interactive terminal interface.

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
│  1. Authoritative Kill Switch Check (SQLite WAL)            │
│  2. Sticky MCP Source Quarantine Check                      │
│  3. Sliding-Window Rate Limiter & Flood Prevention          │
│  4. Action Normalization & RFC 8089 URI Canonicalization    │
│  5. Workspace Boundary Containment & Symlink Validation     │
│  6. Tool Schema Fingerprinting (Rug-Pull Mutation Detection)│
│  7. Behavioral Sequence Engine V2 (Temporal Multi-Step)     │
│  8. Deterministic Risk Assessment (0–100 CWE Score)         │
│  9. Versioned Policy Evaluation (Additive Specificity)      │
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
         │   Post-Approval Comprehensive Check       │
         │   (Context Hash, Expiration, Policy Ver)  │
         ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    DOWNSTREAM EXECUTION                     │
│  - Bounded Execution Timeouts (Default 30s)                 │
│  - Deep Result & Secret Inspection (API Keys, JWT, AWS, SSH)│
│  - Automatic Leak Redaction & Memory Safety Bounds (500KB)  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│           CRYPTOGRAPHIC SQLITE AUDIT PERSISTENCE            │
│  - SHA-256 Hash Chaining across all Historical Events       │
│  - Canonical Recursive JSON Key Ordering (No Key-Drift)     │
│  - Strict Sequence Monotonicity & Genesis Verification      │
│  - Transactional Database Migrations (WAL Mode)             │
│  - Automated Security Incident Creation & Triage            │
└──────────────────────────────┬──────────────────────────────┘
                               │ SSE (Server-Sent Events)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│         Web DevTools Control Plane (http://localhost:4040)  │
│  - Real-Time Action Stream   - Interactive Approval Modal   │
│  - Tool Integrity Matrix     - Behavioral Sequence Flow     │
│  - Unified File Diffs        - Process Output Inspection    │
│  - Security Incident Center  - MCP Source Quarantine & Trust│
│  - Policy Version Rollbacks  - Explainable Risk Breakdown   │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Capabilities (V4.1.0 HARDENING RELEASE)

- 🛡️ **Deterministic Policy Engine:** Zero LLM heuristics. Strictly synchronous, rule-based policy evaluation with additive specificity scoring.
- 🚦 **Three-Tier Policy Decisions:**
  - **`ALLOW`:** Safe actions (workspace file reads, non-destructive test commands) execute immediately.
  - **`DENY`:** Dangerous actions (`.env` secrets, SSH keys, destructive root commands) are blocked immediately with zero tool execution.
  - **`ASK`:** Risky mutations (`git push`, `npm install`, network calls) pause agent execution until approved via the **Terminal** or **Web Dashboard**.
- 🛑 **Authoritative Local Kill Switch:** Instant SQLite-backed circuit breaker (`agent-monitor kill`) with pre- and post-approval revalidation to eliminate race conditions.
- 🔌 **Universal MCP Stdio Gateway:** Transparent proxy for Claude Desktop, Cursor, and any MCP client/server without modifying application code.
- 🧬 **Tool Fingerprinting & Rug-Pull Detection:** Computes cryptographic SHA-256 fingerprints of discovered tools, flagging runtime mutation attempts before execution.
- 🔒 **Approval Context Binding & Expiration Invalidation:** Approvals bind immutable context hashes (`actionContextHash`) and timeout expirations to prevent parameter tampering or stale approvals.
- 🌊 **Behavioral Sequence Correlator V2:** Detects complex temporal multi-step attack sequences (`SEC_MUTATION_TO_READ`, `SEC_TRAVERSAL_TO_EXEC`, `SEC_DENIAL_TO_ALTERNATIVE`, `SEC_SENSITIVE_TO_NETWORK`).
- 📁 **Multi-Platform Path Traversal Containment:** Defeats null-byte injections, multi-layer URL encodings (`%252e%252e%252f`), Unicode normalization bypasses, Windows drive letter escapes on POSIX, and UNC network share escapes.
- 🔗 **Cryptographic Audit Hash Chaining:** Every audit event is chained with SHA-256 hashes linking `prev_hash` to `hash`. Canonical JSON formatting (`canonicalizeJson`) guarantees identical hashes regardless of object key order.
- 🔍 **Deep Secret Inspection & Redaction:** Inspects tool outputs and resource reads, detecting and replacing sensitive keys (OpenAI, Anthropic, AWS, GitHub, Slack, PEM private keys, JWTs) with `[REDACTED:<type>]`.
- ⏱️ **Resource Exhaustion Bounds:** 1MB ceiling on incoming tool arguments, 500KB response truncation, 10MB framing buffer limits, and 30s downstream timeouts.
- 🚨 **Security Incident Case Management:** Automatically tracks incidents with severity ratings, correlated forensics, and lifecycle transitions (`OPEN` → `INVESTIGATING` → `CONTAINED` → `RESOLVED`).
- 🛑 **Sticky MCP Source Quarantine:** Isolates compromised or rogue MCP servers immediately (`agent-monitor mcp quarantine <sourceId>`), persisting quarantine status across restarts.
- 🏥 **Health & Diagnostic Commands:** Comprehensive system diagnostics (`agent-monitor health`), canonical audit export (`agent-monitor audit export`), and policy schema validation (`agent-monitor policy validate`).
- 🤖 **Machine-Readable `--json` Output:** Every operational CLI command supports `--json` for seamless CI/CD, SIEM, and SOC scripting integration.
- 🖥️ **Full-Featured Web Control Plane:** Next.js dashboard equipped with dedicated views for **Timeline**, **Incidents**, **MCP Sources**, and **Policies**.

---

## Quick Start

### 1. Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Package Manager**: `npm`, `pnpm`, or `yarn`

### 2. Installation & Bootstrap

Clone the repository:

```bash
git clone https://github.com/agentsentry/agentsentry.git
cd agentsentry
npm install
```

Initialize your workspace configuration:

```bash
npm run cli -- config init
```

Validate your configuration:

```bash
npm run cli -- policy validate agent-monitor.config.json
```

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

### 2. Transparent Model Context Protocol (MCP) Stdio Proxy

Wrap any external MCP server to enforce deterministic policies, tool schema fingerprinting, and runtime rug-pull detection:

```bash
# Intercept filesystem MCP server
npm run cli -- mcp proxy -- npx -y @modelcontextprotocol/server-filesystem /path/to/workspace
```

### 3. Authoritative Kill Switch Circuit Breaker

Instantly halt an active session across all tools and gateways:

```bash
# Activate kill switch
npm run cli -- kill --session <session-id> --reason "Suspicious activity detected"

# Resume session execution
npm run cli -- resume --session <session-id>
```

### 4. Policy Versioning & Instant Rollbacks

Inspect policy version history, diff rule configurations, toggle rules, or roll back instantly:

```bash
# List all immutable policy versions
npm run cli -- policy versions

# Compute visual or JSON diff between two versions
npm run cli -- policy diff 1 2

# Roll back active policy to historical version
npm run cli -- policy rollback 1
```

### 5. Security Incident Operations

Inspect automatically created incidents, update triage status, and review correlated forensic events:

```bash
# List open incidents with severity filters
npm run cli -- incidents list --status OPEN --severity CRITICAL

# Show detailed incident diagnostics
npm run cli -- incidents show <incident-id>

# Triage incident status
npm run cli -- incidents update <incident-id> --status CONTAINED --notes "Isolated rogue agent process"
```

### 6. Sticky MCP Source Quarantine & Trust

Isolate untrusted or compromised MCP servers immediately across process restarts:

```bash
# List registered MCP server sources
npm run cli -- mcp list

# Quarantine rogue MCP source
npm run cli -- mcp quarantine <source-id> --reason "Dynamic tool mutation detected"

# Lift quarantine and restore trust
npm run cli -- mcp trust <source-id>
```

### 7. Tamper-Evident Audit Verification & Export

Verify SHA-256 hash chaining of historical events in SQLite to detect tampering:

```bash
# Verify cryptographic hash chain across all sessions
npm run cli -- audit verify

# Export canonical deterministic JSON audit ledger
npm run cli -- audit export --session <session-id> --output audit-ledger.json
```

### 8. System Health Diagnostics

Run comprehensive system, SQLite database page integrity, and server health diagnostics:

```bash
npm run cli -- health --json
```

### 9. Start the Standalone Web Dashboard

Explore recorded session logs, unified diffs, incident center, MCP sources, and policies in the DevTools UI:

```bash
npm run cli -- server
```

Open **`http://localhost:4040`** in your browser.

---

## Monorepo Architecture

```text
agent-monitor/
├── packages/
│   ├── core/      # Pure domain models, versioned policy engine, behavioral v2, hash chaining, secret redactor
│   ├── server/    # SQLite WAL repository & migrations (001-007), EventBus, SSE & REST API, sticky quarantine
│   ├── agent/     # ActionInterceptor, Safe Tools, ApprovalManager, path containment guardrails
│   ├── gateway/   # Universal MCP Stdio Proxy, sliding-window rate limit, execution timeouts, secret inspection
│   └── cli/       # Unified CLI binary (`agent-monitor`) with machine-readable --json mode
├── apps/
│   └── web/       # Next.js 15 Alabaster/Ink/Burnt Terra Cotta Control Plane (Timeline, Incidents, MCP, Policies)
└── docs/          # Comprehensive technical documentation & runbooks
```

| Package | Version | Description |
| :--- | :--- | :--- |
| [`@agent-monitor/core`](packages/core/README.md) | `4.1.0` | Pure domain types, action models, risk analyzer, versioned policy engine, behavioral sequences, audit hash chaining, secret redactor. |
| [`@agent-monitor/server`](packages/server/README.md) | `4.1.0` | Local SQLite WAL persistence, database migrations (001-007), authoritative kill switch, sticky MCP quarantine, incident triage. |
| [`@agent-monitor/agent`](packages/agent/README.md) | `4.1.0` | Security guardrails, safe tools, `ActionInterceptor`, approval manager, path containment, and reference DeepSeek coding agent. |
| [`@agent-monitor/gateway`](packages/gateway/README.md) | `4.1.0` | Universal Agent Control Boundary, transparent MCP proxy, rate limiting, execution timeouts, output secret inspection. |
| [`@agent-monitor/cli`](packages/cli/README.md) | `4.1.0` | Unified CLI binary (`run`, `server`, `policy`, `incidents`, `mcp`, `audit`, `health`, `events`, `kill`, `resume`, `tools`). |
| [`@agent-monitor/web`](apps/web/README.md) | `4.1.0` | Next.js DevTools dashboard for activity streams, diffs, security incidents, MCP quarantine matrix, and policy version management. |

---

## Documentation Index

| Guide | Description |
| :--- | :--- |
| 🏛️ [**Architecture**](docs/architecture.md) | System components, 13-stage security invariant, SQLite WAL transactions, package boundaries. |
| 🔒 [**Security Model**](docs/security.md) | Guardrails, path containment, approval context hashes, secret redaction, audit chaining. |
| 🎯 [**Threat Model**](docs/threat-model.md) | STRIDE classification, trust boundaries, adversarial attack vectors, fail-closed invariants. |
| 🚨 [**Incident Response**](docs/incident-response.md) | Incident lifecycle, forensic investigation, containment runbook, kill switch procedures. |
| ⚙️ [**Production Operations**](docs/operations.md) | SQLite WAL maintenance, checkpoints, backups, sizing, health checks, server deployment. |
| 🩹 [**Disaster Recovery**](docs/recovery.md) | Crash recovery, database corruption salvage, audit tampering investigation, policy rollback. |
| 🧪 [**Adversarial Testing**](docs/adversarial-testing.md) | Verification suites, path traversal fuzzing, JSON-RPC fuzzing, throughput benchmarks. |
| 💻 [**CLI Manual**](docs/cli.md) | Complete CLI reference for all commands, options, machine-readable `--json`, exit codes. |
| 🖥️ [**Dashboard Guide**](docs/dashboard.md) | Activity stream filtering, security incident center, MCP source management, policies. |
| 🛡️ [**Policies & Rules**](docs/policies.md) | Deterministic specificity calculation, versioning, diffs, and instant rollback. |
| ⚙️ [**Configuration Guide**](docs/configuration.md) | Full `agent-monitor.config.json` specification and environment variable overrides. |
| 📜 [**Events Reference**](docs/events.md) | Complete schema of all domain events, cryptographic hash chaining, and replay. |

---

## Testing & Quality

Agent Monitor maintains **34 test suites** containing **186 tests** passing at 100% with zero regressions:

```bash
npm test
```

### Performance Benchmarks
- **Cryptographic Hash Chaining**: ~25,000 events/sec (exceeds 5,000 target)
- **Deterministic Policy Evaluation**: ~120,000 evaluations/sec (exceeds 20,000 target)
- **Workspace Path Normalization**: ~200,000 checks/sec (exceeds 40,000 target)

---

## License

MIT © [Agent Monitor Contributors](LICENSE)
