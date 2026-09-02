# Agent Monitor Architecture (V0.2 OBSERVE + CONTROL)

Agent Monitor is architected as a **local-first, deterministic control plane** for autonomous AI coding agents.

---

## High-Level Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              AGENT RUNTIME                             │
│                                                                        │
│   ┌────────────────────────┐         ┌─────────────────────────────┐   │
│   │  DeepSeek Coding Agent │ ◄─────► │     Safe Tool Definitions   │   │
│   │  (LLM Prompt & Loop)   │         │ (file.read/write/list, exec)│   │
│   └───────────┬────────────┘         └──────────────┬──────────────┘   │
│               │                                     │                  │
│               │ Tool Call Intent                    │                  │
│               ▼                                     │                  │
│   ┌─────────────────────────────────────────────────┴──────────────┐   │
│   │                       ACTION INTERCEPTOR                       │   │
│   │  1. Guardrails (Path resolution & symlink boundary check)      │   │
│   │  2. Risk Analyzer (Deterministic CWE heuristic scoring 0-100)  │   │
│   │  3. Policy Engine (Deterministic Additive Specificity)         │   │
│   │  4. Approval Manager (Human-in-the-loop pause/resolve)         │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ Authoritative Events
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                             MONITOR SERVER                             │
│                                                                        │
│   ┌────────────────────────┐         ┌─────────────────────────────┐   │
│   │  SQLite WAL Database   │ ◄─────► │    In-Memory EventBus       │   │
│   │  (data.db: sessions,   │         │   (Per-session pub/sub)     │   │
│   │   events, approvals)   │         │                             │   │
│   └────────────────────────┘         └──────────────┬──────────────┘   │
│                                                     │ SSE Stream       │
│                                                     ▼                  │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │       HTTP REST API & Embedded Static DevTools Web UI          │   │
│   │       - GET  /health           - GET  /events/stream           │   │
│   │       - GET  /policy           - POST /approvals/:id/approve   │   │
│   │       - POST /policy/evaluate  - POST /approvals/:id/deny      │   │
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
- **Domain Types**: `ActionKind`, `ActionCategory`, `AgentEvent`, `AgentSession`, `ApprovalRequest`.
- **Deterministic Risk Engine**: `RiskAnalyzer` evaluates parameters against 8 security rules (e.g. `SEC_DOTENV`, `SEC_SSH_KEYS`, `CMD_DESTRUCTIVE_RM`, `PATH_TRAVERSAL`).
- **Deterministic Policy Engine**: `PolicyEngine` evaluates additive specificity across Action, Path, Command, and Context dimensions.

### 2. `@agent-monitor/server`

- **Local SQLite WAL Database**: `SessionRepository` stores `sessions`, `events`, and `approvals` tables.
- **Atomic Approval Resolution**: `UPDATE approvals SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`. Only `changes === 1` succeeds, eliminating race conditions.
- **EventBus & SSE**: Delivers real-time server-sent events to connected dashboard tabs and terminal loggers.
- **Static Web Hosting**: Embeds the compiled Next.js DevTools dashboard.

### 3. `@agent-monitor/agent`

- **Guardrails**: `resolveSafeWorkspacePath` validates path containment and checks for symlink escapes.
- **Safe Tool Implementations**: `readFileTool`, `writeFileTool`, `listFilesTool`, `runCommandTool`.
- **ActionInterceptor**: The gatekeeper wrapping tool execution.
- **ApprovalManager**: Asynchronous coordinator that pauses execution when policy decision is `ASK` and wakes up upon resolution.
- **Reference Agent**: `DeepSeekCodingAgent` provides an autonomous prompt loop powered by DeepSeek API.

### 4. `@agent-monitor/cli`

- Binary entrypoint (`agent-monitor`).
- Commands: `run`, `server`, `policy check`, `config init`, `config validate`, `sessions`, `status`.

### 5. `@agent-monitor/web`

- Next.js 15 App Router interface styled in **Alabaster, Ink, and Burnt Terra Cotta**.
- Features: Real-time action stream, unified diffs, terminal outputs, timeline inspector, and interactive approval modal.

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
  policy.evaluated → approval.requested → approval.resolved(approved) → action.started → tool.execute() → action.completed

ASK + Denied Path:
  policy.evaluated → approval.requested → approval.resolved(denied) → action.blocked
  (Tool execution count = 0, action.started is never emitted)

ASK + Expired Path:
  policy.evaluated → approval.requested → approval.resolved(expired) → action.blocked
  (Tool execution count = 0, action.started is never emitted)
```

---

## Source of Truth & Local-First Invariants

1. **SQLite is the Single Source of Truth**: All actions and events are committed to SQLite before being dispatched to SSE subscribers or external listeners.
2. **Deterministic & Synchronous Policies**: The Policy Engine contains zero LLM inference or probabilistic scoring. Evaluation is 100% deterministic and synchronous.
3. **Provider Independence**: `@agent-monitor/core` and `@agent-monitor/server` have zero awareness of DeepSeek or any specific LLM provider.
