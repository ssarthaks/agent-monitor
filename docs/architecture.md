# Agent Monitor Architecture (V4.1.0)

Agent Monitor is architected as a **local-first, production control plane, universal security boundary, and security operations center** for autonomous AI coding agents and Model Context Protocol (MCP) clients.

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
│   1. Ingress Request Framing & Payload Bounds (10MB / 1MB)             │
│   2. Authoritative Kill Switch Circuit Breaker (SQLite WAL)            │
│   3. Sticky MCP Source Quarantine Check (SQLite-Backed)                │
│   4. Sliding-Window Rate Limiter & Flood Prevention                    │
│   5. Action Normalization & RFC 8089 URI Canonicalization              │
│   6. Workspace Boundary Containment & Symlink Validation               │
│   7. Tool Schema Fingerprinting (SHA-256 Rug-Pull Detection)           │
│   8. Risk Assessment & Behavioral Sequence Matching V2                 │
│   9. Versioned Additive Policy Evaluation (DENY > ASK > ALLOW)         │
│  10. Human-in-the-Loop Approvals (Terminal & Web UI)                   │
│  11. Post-Approval Comprehensive Revalidation                          │
│      - Action Context Hash Match                                       │
│      - Approval Expiration Verification                                │
│      - Active Policy Version Match                                     │
│      - Secondary Kill Switch & Quarantine Check                        │
│  12. Controlled Downstream Execution (30s Bounded Timeouts)            │
│  13. Result Inspection & Deep Secret Redaction (500KB Cap)             │
│  14. SQLite WAL Persistence with SHA-256 Hash Chaining & Escalation    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Authoritative Chained Events
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                             MONITOR SERVER                             │
│                                                                        │
│   ┌────────────────────────┐         ┌─────────────────────────────┐   │
│   │  SQLite WAL Database   │ ◄─────► │    In-Memory EventBus       │   │
│   │  - sessions            │         │   (Per-session pub/sub)     │   │
│   │  - events (hash chain) │         │                             │   │
│   │  - approvals           │         └──────────────┬──────────────┘   │
│   │  - tool_fingerprints   │                        │ SSE Stream       │
│   │  - behavioral_matches  │                        ▼                  │
│   │  - policy_versions     │         ┌─────────────────────────────┐   │
│   │  - incidents           │         │ Web DevTools Dashboard      │   │
│   │  - mcp_sources         │         │ (http://localhost:4040)     │   │
│   └────────────────────────┘         └─────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Core Components & Package Boundaries

### 1. `@agent-monitor/core`
- **Zero external dependencies**, pure domain logic.
- **Domain Types**: `ActionKind`, `ActionCategory`, `AgentEvent`, `AgentSession`, `ApprovalRequest`, `ExternalToolDefinition`, `SecurityIncident`, `McpSource`.
- **Normalization Engine**: `ActionNormalizer` maps raw MCP calls, process commands, and resource URIs into strongly typed canonical actions.
- **Deterministic Risk Engine**: `RiskAnalyzer` evaluates parameters against CWE security rules with RFC 8089 URI normalization and path containment flags.
- **Deterministic Policy Engine**: `PolicyEngine` evaluates additive specificity across Action, Path, Command, Context, and Sequence dimensions.
- **Centralized Policy Versioning**: `PolicyEngine`, `diffPolicyVersions`, `rollbackPolicyVersion`, and SHA-256 content hash computation.
- **Behavioral Sequence Engine V2**: `BehavioralEngine` correlates temporal multi-step attack sequences (`SEC_MUTATION_TO_READ`, `SEC_TRAVERSAL_TO_EXEC`, `SEC_DENIAL_TO_ALTERNATIVE`, `SEC_SENSITIVE_TO_NETWORK`) with bounded sliding memory windows.
- **Tool Fingerprinting**: `computeToolFingerprint` and `computeToolSchemaFingerprint` generate cryptographic SHA-256 signatures of tool definitions to detect runtime mutation (rug-pull) attacks.
- **Cryptographic Audit Integrity**: `computeEventHash`, `verifyEventChain`, `canonicalizeJson`, and `exportCanonicalLedger` implement append-only SHA-256 hash chaining across historical events.
- **Deep Secret Redactor**: `redactSecretsDeep` scans objects for API keys, AWS credentials, JWT tokens, and private keys, replacing them with `[REDACTED:<type>]`.

### 2. `@agent-monitor/server`
- **Local SQLite WAL Database**: `SessionRepository` manages authoritative persistence with `busy_timeout = 5000` and `synchronous = NORMAL`.
- **Database Migrations**: Transactional migrations (`001` through `007`) handling schema evolution, performance indexes, policy versions, incidents, MCP sources, and hash chaining.
- **Authoritative Kill Switch**: Instant circuit breaker state machine (`isKillSwitchActive`, `setKillSwitch`) persisted in SQLite.
- **Sticky MCP Quarantine**: Isolates untrusted sources across process restarts until an operator explicitly trusts them.
- **Incident Lifecycle Management**: Auto-creates security incident records for critical violations with status transitions and correlated events.
- **Atomic Approval Resolution**: `UPDATE approvals SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`. Only `changes === 1` succeeds, eliminating race conditions.
- **EventBus & SSE**: Delivers real-time server-sent events to connected dashboard tabs and terminal loggers.
- **Static Web Hosting & Security**: Embeds the compiled Next.js DevTools dashboard with strict local-origin CORS validation.

### 3. `@agent-monitor/agent`
- **Guardrails**: `resolveSafeWorkspacePath` validates path containment with iterative URL decoding, POSIX and Windows backslash normalization, null-byte injection detection, UNC network share blocking, and symlink escape checks.
- **Safe Tool Implementations**: `readFileTool`, `writeFileTool`, `listFilesTool`, `runCommandTool`.
- **Process Isolation**: `runCommandTool` strips sensitive environment credentials (`process.env`) before child process spawning.
- **ActionInterceptor**: Enforces authoritative pre- and post-approval Kill Switch checks, risk analysis, policy evaluation, and event sequencing.
- **ApprovalManager**: Asynchronous coordinator that pauses execution when policy decision is `ASK` and wakes up upon resolution.
- **Reference Agent**: `DeepSeekCodingAgent` provides an autonomous prompt loop powered by DeepSeek API.

### 4. `@agent-monitor/gateway`
- **Universal MCP Stdio Gateway**: Transparent JSON-RPC 2.0 proxy wrapping any downstream MCP server.
- **Protocol Interception**: Enforces full security invariant for `tools/call` and `resources/read`. Discovers and registers tool baselines on `tools/list`.
- **RFC 8089 Fail-Closed URI Containment**: Leverages standard `fileURLToPath` and fails closed on invalid remote or UNC hosts.
- **Payload Size Bounding**: Rejects tool call arguments exceeding 1MB with JSON-RPC error -32602.
- **Sticky Source Quarantine**: Blocks all calls from quarantined sources fail-closed before any processing.
- **Sliding-Window Rate Limiting**: Enforces configurable requests-per-minute thresholds to prevent command flooding.
- **Execution Timeouts**: Attaches bounded timeouts (default 30s) to downstream requests with guaranteed cleanup on completion, error, or process exit.
- **Result Inspector**: `McpResultInspector` detects and redacts leaked credentials and truncates responses exceeding 500KB.

### 5. `@agent-monitor/cli`
- Binary entrypoint (`agent-monitor`).
- Commands for agent orchestration, policy simulation, version rollbacks, incident triage, MCP quarantine, cryptographic audit verification, and health diagnostics.
- Supports `--json` machine-readable output across all operational commands.

### 6. `@agent-monitor/web`
- Next.js 15 App Router interface.
- Dedicated views for **Timeline**, **Incidents**, **MCP Sources**, and **Policies**.

---

## Non-Negotiable 14-Stage Security Invariant

```text
 1. INGRESS REQUEST & PAYLOAD BOUNDS (10MB JSON-RPC frame, 1MB arguments)
   ↓
 2. KILL SWITCH (Authoritative SQLite WAL Check)
   ↓
 3. SOURCE QUARANTINE (Sticky Isolation)
   ↓
 4. RATE LIMITING (Sliding Window)
   ↓
 5. ACTION NORMALIZATION (RFC 8089 URI Canonicalization)
   ↓
 6. WORKSPACE GUARDRAILS (Path Traversal & Symlink Escapes)
   ↓
 7. RISK ASSESSMENT & SCHEMA MUTATION CHECK (CWE Scored Analysis)
   ↓
 8. DETERMINISTIC POLICY EVALUATION (Additive Specificity: DENY > ASK > ALLOW)
   ↓
 9. HUMAN APPROVAL IF ASK (Terminal / Web UI)
   ↓
10. POST-APPROVAL COMPREHENSIVE REVALIDATION
    - Hash Context Match (No Parameter Tampering)
    - Expiration Check
    - Active Policy Version Match
    - Kill Switch & Quarantine Re-Verification
   ↓
11. DOWNSTREAM EXECUTION (with Bounded Timeouts & Idempotency)
   ↓
12. RESULT INSPECTION & SECRET REDACTION (500KB Bound)
   ↓
13. SQLITE WAL PERSISTENCE WITH SHA-256 HASH CHAINING
   ↓
14. AUTOMATIC INCIDENT ESCALATION & CLIENT DISPATCH
```

---

## Database Migrations

| Migration | Name | Description |
| :--- | :--- | :--- |
| `001_initial_schema` | Initial Core Schema | Base tables: `sessions`, `events`, `approvals`, `tool_fingerprints`, `behavioral_matches`. |
| `002_performance_indexes` | Performance Indexes | High-speed lookup indexes on `(session_id, sequence)`, `(status)`, and timestamps. |
| `003_policy_versions` | Policy Versioning | Tables `policy_versions` and `policy_history` for immutable versioning and rollback. |
| `004_incidents` | Incident Case Model | Tables `incidents` and `incident_events` for security incident tracking. |
| `005_mcp_sources` | MCP Source Registry | Table `mcp_sources` for tracking server health and sticky quarantine status. |
| `006_audit_hash_chain` | Cryptographic Hash Chaining | Adds `hash` and `prev_hash` columns and indexes to `events` table for tamper detection. |
| `007_v41_production_hardening` | Production Hardening | Adds `policy_version`, `expires_at`, and `action_context_hash` to approvals; adds transport and schema fingerprints to MCP sources. |
