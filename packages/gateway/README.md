# `@agent-monitor/gateway`

Universal Agent Control Boundary & Transparent Model Context Protocol (MCP) Stdio Proxy for Agent Monitor (V0.3).

---

## Overview

`@agent-monitor/gateway` provides a transparent, zero-overhead stdio interceptor that sits between any MCP client (such as Claude Desktop, Cursor, Continue, or custom agent runtimes) and downstream MCP servers.

It enforces the non-negotiable **Core Security Invariant** across all tool calls and resource accesses:

$$\text{REQUEST} \longrightarrow \text{KILL SWITCH} \longrightarrow \text{NORMALIZATION} \longrightarrow \text{GUARDRAILS} \longrightarrow \text{RISK} \longrightarrow \text{POLICY} \longrightarrow \text{APPROVAL} \longrightarrow \text{POST-APPROVAL KILL CHECK} \longrightarrow \text{EXECUTION} \longrightarrow \text{INSPECTION} \longrightarrow \text{SQLITE}$$

---

## Key Features

- **Universal Stdio Interception**: Intercepts JSON-RPC 2.0 frames over `stdin`/`stdout` without requiring modifications to agent or server code.
- **Strict RFC 8089 URI & Path Normalization**: Resolves `file://localhost/...`, UNC network shares, and custom URIs with fail-closed security.
- **Tool Fingerprinting & Rug-Pull Detection**: Computes cryptographic SHA-256 signatures of tool definitions discovered via `tools/list`. Flags runtime mutations and schema alterations before execution.
- **Authoritative Pre- & Post-Execution Kill Switch**: Checks SQLite-backed circuit breaker state before and immediately after human approval to eliminate race conditions.
- **Human-in-the-Loop Approvals**: Prompts operators via terminal or web dashboard when policies evaluate to `ASK`.
- **Deep Result Inspection**: Inspects tool and resource responses for sensitive leaks (PEM private keys, credentials) and bounds payload output sizes.
- **Behavioral Sequence Integration**: Correlates multi-step sequences across sessions (e.g. sensitive file reads followed by network requests or command executions).

---

## Architecture

```text
┌─────────────────┐
│   MCP Client    │ (Claude Desktop, Cursor, Custom Agent)
└────────┬────────┘
         │ JSON-RPC (stdio)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   McpStdioProxy (Gateway)                   │
│                                                             │
│  1. Authoritative Pre-Kill Switch Check                    │
│  2. Action Normalization & Canonical Classification         │
│  3. RFC 8089 & Workspace Guardrail Validation               │
│  4. Deterministic Risk Scoring (0–100)                      │
│  5. Policy Evaluation (ALLOW / DENY / ASK)                  │
│  6. Human-in-the-Loop Approval Workflow                     │
│  7. Post-Approval Kill Switch Verification                  │
│  8. Tool Schema Mutation Check (Rug-Pull Detection)         │
│  9. Downstream Execution                                    │
│ 10. McpResultInspector (Secret Redaction & Truncation)      │
│ 11. Monotonic Event Sequencing to SQLite Persistence        │
└────────┬────────────────────────────────────────────────────┘
         │ JSON-RPC (stdio)
         ▼
┌─────────────────┐
│ Downstream MCP  │ (Filesystem, Postgres, Shell, GitHub, etc.)
│ Server Process  │
└─────────────────┘
```

---

## Method Security Table

| JSON-RPC Method   | Security Handling                                                                                                                      |
| :---------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/call`      | Full invariant: Kill switch, normalization, workspace check, risk, policy, approval, execution, result inspection, SQLite persistence. |
| `resources/read`  | Full invariant: URI normalized via `fileURLToPath`, workspace containment, risk, policy, approval, execution, inspection.              |
| `tools/list`      | Discovers tools, computes SHA-256 fingerprint, persists baselines, detects runtime mutations (`TOOL_CHANGED`).                         |
| `resources/list`  | Audited and forwarded downstream.                                                                                                      |
| `notifications/*` | Validated for well-formed JSON-RPC; bypasses execution pipeline without triggering actions.                                            |
| Batch Requests    | Each request inside a batch is evaluated individually with full security guarantees.                                                   |

---

## Installation

```bash
npm install @agent-monitor/gateway @agent-monitor/core @agent-monitor/server @agent-monitor/agent
```

---

## Programmatic Usage

```typescript
import { McpStdioProxy } from "@agent-monitor/gateway";
import { PolicyEngine } from "@agent-monitor/core";
import { SessionRepository, createDatabase } from "@agent-monitor/server";

const db = createDatabase("./data.db");
const repository = new SessionRepository(db);

const proxy = new McpStdioProxy({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/safe/workspace"],
  sessionId: "ses_mcp_prod",
  workspaceRoot: "/safe/workspace",
  repository,
  policyEngine: new PolicyEngine(),
  eventSink: {
    emit: async (event) => console.log("Audit Event:", event.type),
  },
  clientInputStream: process.stdin,
  clientOutputStream: process.stdout,
});

await proxy.start();
```
