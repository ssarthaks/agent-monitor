# Domain Events Specification

Agent Monitor uses an **append-only, immutable event log** stored in SQLite and streamed via SSE (Server-Sent Events).

---

## 1. Event Structure

Every event implements the base `AgentEvent` interface:

```typescript
export interface BaseAgentEvent {
  id: string; // Unique event ID (e.g. "evt_mth123_abc45")
  sequence: number; // Monotonically increasing sequence per session (1, 2, 3...)
  sessionId: string; // Session ID (e.g. "ses_mtjyivct_7yf92")
  agentId: string; // Agent identifier (e.g. "deepseek-coding-agent")
  timestamp: number; // Unix timestamp in milliseconds
  type: string; // Event type discriminator
}
```

---

## 2. Complete Event Catalog (21 Events)

| Event Type | Description | Key Payload Fields |
| :--- | :--- | :--- |
| **`session.started`** | Emitted when a new agent monitoring session begins. | `task`, `workspaceRoot`, `provider`, `model` |
| **`session.ended`** | Emitted when an agent finishes its task. | `status`, `durationMs`, `summary` (`totalActions`, `overallRiskScore`, `approvedCount`, `blockedCount`) |
| **`agent.message`** | Human-readable explanation or response from the agent. | `content` |
| **`policy.evaluated`** | Result of deterministic policy evaluation before any execution. | `actionId`, `decision` (`ALLOW`/`DENY`/`ASK`), `matchedPolicies`, `specificity`, `reason` |
| **`approval.requested`** | Emitted when an action is evaluated as `ASK` and requires human sign-off. | `approvalId`, `actionId`, `actionKind`, `params`, `risk`, `reason` |
| **`approval.resolved`** | Emitted once upon human or timeout resolution. | `approvalId`, `actionId`, `decision` (`approved`/`denied`/`expired`), `resolvedBy` |
| **`action.started`** | Emitted immediately before tool execution begins (only for `ALLOW` or approved actions). | `actionId`, `kind`, `category`, `params`, `risk` |
| **`action.completed`** | Emitted upon successful tool execution with results and diffs. | `actionId`, `result`, `durationMs`, `metadata` (`diff`, `linesChanged`, `exitCode`) |
| **`action.failed`** | Emitted when tool execution throws an error. | `actionId`, `error`, `durationMs` |
| **`action.blocked`** | Emitted when an action is blocked by policy `DENY`, human denial, or Kill Switch. | `actionId`, `reason`, `risk`, `policy` |
| **`tool.discovered`** | Emitted when an external tool is first discovered with baseline SHA-256 fingerprint. | `toolName`, `source`, `fingerprint`, `description` |
| **`tool.changed`** | Emitted when an external tool's schema or parameters change at runtime (rug-pull). | `toolName`, `source`, `oldFingerprint`, `newFingerprint`, `changeCount` |
| **`behavioral.match`** | Emitted when a multi-step behavioral sequence rule triggers. | `ruleId`, `name`, `severity`, `triggeringActionId`, `priorActionIds` |
| **`control.kill_switch_enabled`** | Emitted when the local Kill Switch circuit breaker is authoritatively activated. | `sessionId`, `reason`, `activatedAt` |
| **`control.kill_switch_disabled`** | Emitted when the local Kill Switch circuit breaker is deactivated/resumed. | `sessionId`, `resumedAt` |
| **`incident.created`** | Emitted when a new security incident case is created. | `incidentId`, `title`, `severity`, `status`, `sessionId` |
| **`incident.updated`** | Emitted when an incident's triage status, severity, or notes are updated. | `incidentId`, `status`, `severity`, `notes` |
| **`mcp.started`** | Emitted when an MCP proxy session connects to a downstream server. | `sourceId`, `serverName`, `command` |
| **`mcp.crashed`** | Emitted when a downstream MCP server process exits unexpectedly. | `sourceId`, `exitCode`, `signal` |
| **`mcp.quarantined`** | Emitted when an untrusted or rogue MCP source is placed under sticky quarantine. | `sourceId`, `reason`, `quarantinedAt` |
| **`policy.changed`** | Emitted when an active policy version is changed, rolled back, or rule toggled. | `versionId`, `versionNumber`, `action` (`activated`/`rollback`/`toggle`) |

---

## 3. Strict Event Ordering Guarantees

Agent Monitor enforces deterministic event lifecycles:

### Lifecycle 1: Immediate Permission (`ALLOW`)

```text
policy.evaluated ──► action.started ──► tool.execute() ──► action.completed
```

### Lifecycle 2: Immediate Policy Block (`DENY`)

```text
policy.evaluated ──► action.blocked
```

_(Tool is executed 0 times. `action.started` is strictly never emitted)._

### Lifecycle 3: Human Approved (`ASK` + Approved)

```text
policy.evaluated ──► approval.requested ──► approval.resolved(approved) ──► action.started ──► tool.execute() ──► action.completed
```

### Lifecycle 4: Human Denied (`ASK` + Denied)

```text
policy.evaluated ──► approval.requested ──► approval.resolved(denied) ──► action.blocked
```

_(Tool is executed 0 times)._

### Lifecycle 5: Approval Timeout (`ASK` + Expired)

```text
policy.evaluated ──► approval.requested ──► approval.resolved(expired) ──► action.blocked
```

_(Tool is executed 0 times)._

---

## 4. SQLite Storage & Replay

All events are stored in the SQLite `events` table with cryptographic hash chaining:

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL,
  hash TEXT,
  prev_hash TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_events_session_sequence ON events(session_id, sequence);
CREATE INDEX idx_events_hash ON events(hash);
CREATE INDEX idx_events_type ON events(type);
```

When a browser connects or reconnects via SSE (`GET /events/stream?sessionId=...&afterSeq=12`), the server queries SQLite for all missed events since `afterSeq`, guaranteeing **zero event loss during network interruptions**.

---

## 5. Cryptographic Hash Chaining Integrity

For every event inserted into SQLite, a cryptographic SHA-256 hash is computed:

$$\text{hash} = \text{SHA-256}\Big(\text{prev\_hash} \,\|\, \text{sequence} \,\|\, \text{timestamp} \,\|\, \text{sessionId} \,\|\, \text{agentId} \,\|\, \text{type} \,\|\, \text{canonicalJSON}(\text{payload})\Big)$$

This forms an unbroken, verifiable ledger where inserting, deleting, or altering any historical event invalidates all subsequent hashes. Verification can be triggered at any time via:

```bash
agent-monitor audit verify
```

