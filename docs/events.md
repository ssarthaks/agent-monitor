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

## 2. Complete Event Catalog (10 Events)

| Event Type               | Description                                                                              | Key Payload Fields                                                                                      |
| :----------------------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| **`session.started`**    | Emitted when a new agent monitoring session begins.                                      | `task`, `workspaceRoot`, `provider`, `model`                                                            |
| **`session.ended`**      | Emitted when an agent finishes its task.                                                 | `status`, `durationMs`, `summary` (`totalActions`, `overallRiskScore`, `approvedCount`, `blockedCount`) |
| **`agent.message`**      | Human-readable explanation or response from the agent.                                   | `content`                                                                                               |
| **`policy.evaluated`**   | Result of deterministic policy evaluation before any execution.                          | `actionId`, `decision` (`ALLOW`/`DENY`/`ASK`), `matchedPolicies`, `specificity`, `reason`               |
| **`approval.requested`** | Emitted when an action is evaluated as `ASK` and requires human sign-off.                | `approvalId`, `actionId`, `actionKind`, `params`, `risk`, `reason`                                      |
| **`approval.resolved`**  | Emitted once upon human or timeout resolution.                                           | `approvalId`, `actionId`, `decision` (`approved`/`denied`/`expired`), `resolvedBy`                      |
| **`action.started`**     | Emitted immediately before tool execution begins (only for `ALLOW` or approved actions). | `actionId`, `kind`, `category`, `params`, `risk`                                                        |
| **`action.completed`**   | Emitted upon successful tool execution with results and diffs.                           | `actionId`, `result`, `durationMs`, `metadata` (`diff`, `linesChanged`, `exitCode`)                     |
| **`action.failed`**      | Emitted when tool execution throws an error.                                             | `actionId`, `error`, `durationMs`                                                                       |
| **`action.blocked`**     | Emitted when an action is blocked by policy `DENY` or human denial.                      | `actionId`, `reason`, `risk`, `policy`                                                                  |

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

All events are stored in the SQLite `events` table:

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_events_session_sequence ON events(session_id, sequence);
```

When a browser connects or reconnects via SSE (`GET /events/stream?sessionId=...&afterSeq=12`), the server queries SQLite for all missed events since `afterSeq`, guaranteeing **zero event loss during network interruptions**.
