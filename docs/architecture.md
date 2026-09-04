# Agent Monitor Architecture (V0.3 UNIVERSAL CONTROL BOUNDARY)

Agent Monitor is architected as a **local-first, deterministic control plane and universal security boundary** for autonomous AI coding agents and Model Context Protocol (MCP) clients.

---

## High-Level Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        AGENT / CLIENT RUNTIMES                         │
│                                                                        │
│   ┌───────────────────────────┐      ┌─────────────────────────────┐   │
│   │ Native Agent Runtime      │      │ External MCP Client         │   │
│   │ (DeepSeek, Custom Loops)  │      │ (Claude Desktop, Cursor)    │   │
│   └─────────────┬─────────────┘      └──────────────┬──────────────┘   │
└─────────────────┼───────────────────────────────────┼──────────────────┘
                  │ Native Tools                      │ Stdio JSON-RPC
                  ▼                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   UNIVERSAL AGENT CONTROL BOUNDARY                     │
│                                                                        │
│   ActionInterceptor (@agent-monitor/agent) OR                          │
│   McpStdioProxy     (@agent-monitor/gateway)                           │
│                                                                        │
│   1. Authoritative Pre-Kill Switch Circuit Breaker                     │
│   2. RFC 8089 URI & Canonical Path Normalization                       │
│   3. Workspace Boundary Guardrails & Symlink Escape Prevention         │
│   4. Tool Schema Fingerprinting (SHA-256 Rug-Pull Detection)           │
│   5. Behavioral Sequence Engine (Multi-Step Exfiltration Correlation)  │
│   6. Deterministic Risk Scoring (0–100 CWE Heuristics)                 │
│   7. Additive Policy Evaluation (ALLOW / DENY / ASK)                   │
│   8. Human-in-the-Loop Approvals (Terminal & Web UI)                   │
│   9. Post-Approval Kill Switch Verification                            │
│  10. Deep Result Inspection & Sensitive Secret Redaction               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Authoritative Events
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                             MONITOR SERVER                             │
│                                                                        │
│   ┌────────────────────────┐         ┌─────────────────────────────┐   │
│   │  SQLite WAL Database   │ ◄─────► │    In-Memory EventBus       │   │
│   │  (sessions, events,    │         │   (Per-session pub/sub)     │   │
│   │   approvals, tools,    │         │                             │   │
│   │   behavioral_matches)  │         │                             │   │
│   └────────────────────────┘         └──────────────┬──────────────┘   │
│                                                     │ SSE Stream       │
│                                                     ▼                  │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │       HTTP REST API & Embedded Static DevTools Web UI          │   │
│   │       - GET  /health           - GET  /events/stream           │   │
│   │       - GET  /policy           - POST /approvals/:id/approve   │   │
│   │       - POST /sessions/:id/kill- POST /approvals/:id/deny      │   │
│   │       - GET  /sessions/:id/tools - GET /sessions/:id/control   │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      CLIENT CONTROL INTERFACES                         │
│                                                                        │
│   ┌─────────────────────────────┐    ┌─────────────────────────────┐   │
│   │   CLI Terminal Live Stream  │    │ Next.js 15 Web Dashboard    │   │
│   │   (readline prompt & logs)  │    │ (http://localhost:4040)     │   │
│   └─────────────────────────────┘    └─────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Core Components & Package Boundaries

### 1. `@agent-monitor/core`

- **Zero external dependencies**, pure domain logic.
- **Domain Types**: `ActionKind`, `ActionCategory`, `AgentEvent`, `AgentSession`, `ApprovalRequest`, `ExternalToolDefinition`.
- **Normalization Engine**: `ActionNormalizer` maps raw MCP calls, process commands, and resource URIs into strongly typed canonical actions.
- **Deterministic Risk Engine**: `RiskAnalyzer` evaluates parameters against CWE security rules with RFC 8089 URI normalization and path containment flags.
- **Deterministic Policy Engine**: `PolicyEngine` evaluates additive specificity across Action, Path, Command, Context, and Sequence dimensions.
- **Behavioral Sequence Engine**: `BehavioralEngine` correlates temporal multi-step security flows (e.g. `SEC_SENSITIVE_TO_NETWORK`) with bounded memory sliding windows.
- **Tool Fingerprinting**: `computeToolFingerprint` generates cryptographic SHA-256 signatures of tool definitions to detect runtime mutation (rug-pull) attacks.

### 2. `@agent-monitor/server`

- **Local SQLite WAL Database**: `SessionRepository` stores `sessions`, `events`, `approvals`, `tool_fingerprints`, and `behavioral_matches` tables.
- **Authoritative Kill Switch**: Instant circuit breaker state machine (`isKillSwitchActive`, `setKillSwitch`) persisted in SQLite.
- **Atomic Approval Resolution**: `UPDATE approvals SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`. Only `changes === 1` succeeds, eliminating race conditions.
- **EventBus & SSE**: Delivers real-time server-sent events to connected dashboard tabs and terminal loggers.
- **Static Web Hosting & Security**: Embeds the compiled Next.js DevTools dashboard with strict local-origin CORS validation.

### 3. `@agent-monitor/agent`

- **Guardrails**: `resolveSafeWorkspacePath` validates path containment with iterative URL decoding, POSIX and Windows backslash normalization, and symlink escape checks.
- **Safe Tool Implementations**: `readFileTool`, `writeFileTool`, `listFilesTool`, `runCommandTool`.
- **Process Isolation**: `runCommandTool` strips sensitive environment credentials (`process.env`) before child process spawning.
- **ActionInterceptor**: Enforces authoritative pre- and post-approval Kill Switch checks, risk analysis, policy evaluation, and event sequencing.
- **ApprovalManager**: Asynchronous coordinator that pauses execution when policy decision is `ASK` and wakes up upon resolution.
- **Reference Agent**: `DeepSeekCodingAgent` provides an autonomous prompt loop powered by DeepSeek API.

### 4. `@agent-monitor/gateway`

- **Universal MCP Stdio Gateway**: Transparent JSON-RPC 2.0 proxy wrapping any downstream MCP server.
- **Protocol Interception**: Enforces full security invariant for `tools/call` and `resources/read`. Discovers and registers tool baselines on `tools/list`.
- **RFC 8089 Fail-Closed URI Containment**: Leverages standard `fileURLToPath` and fails closed on invalid remote or UNC hosts.
- **Result Inspector**: `McpResultInspector` redacts private keys and truncates excessive tool outputs.

### 5. `@agent-monitor/cli`

- Binary entrypoint (`agent-monitor`).
- Commands: `run`, `server`, `policy check`, `mcp proxy`, `kill`, `resume`, `tools`, `security flows`, `config init`, `config validate`, `sessions`, `status`.

### 6. `@agent-monitor/web`

- Next.js 15 App Router interface styled in **Alabaster, Ink, and Burnt Terra Cotta**.
- Features: Real-time action stream, unified diffs, terminal outputs, tool integrity matrix, behavioral sequences, and interactive approval modal.

---

## Event Lifecycle & Strict Ordering

Agent Monitor guarantees strict event emission ordering:

```text
ALLOW Path:
  policy.evaluated → action.started → tool.execute() → action.completed

DENY Path:
  policy.evaluated → action.blocked
  (Tool execution count = 0, action.started is never emitted)

ASK + Approved Path:
  policy.evaluated → approval.requested → approval.resolved(approved) → post-approval kill check → action.started → tool.execute() → action.completed

ASK + Denied Path:
  policy.evaluated → approval.requested → approval.resolved(denied) → action.blocked
  (Tool execution count = 0, action.started is never emitted)

ASK + Expired Path:
  policy.evaluated → approval.requested → approval.resolved(expired) → action.blocked
  (Tool execution count = 0, action.started is never emitted)

KILL SWITCH Active Path:
  action.blocked: Operator Kill Switch
  (Evaluation halts immediately; downstream tool is never reached)
```

---

## Source of Truth & Local-First Invariants

1. **SQLite is the Single Authoritative Source of Truth**: All actions, approvals, tool fingerprints, and control states are committed to SQLite before being dispatched to SSE subscribers or external listeners.
2. **Deterministic & Synchronous Policies**: The Policy Engine contains zero LLM inference or probabilistic scoring. Evaluation is 100% deterministic, synchronous, and rule-based.
3. **Fail-Closed Security**: Any malformed payload, invalid URI, ambiguous path, or active kill switch fails closed immediately.
4. **Provider Independence**: `@agent-monitor/core`, `@agent-monitor/server`, and `@agent-monitor/gateway` have zero awareness of DeepSeek or any specific LLM provider.
