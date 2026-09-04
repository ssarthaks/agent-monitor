# `@agent-monitor/server`

Local SQLite WAL persistence, atomic approval resolution, in-memory EventBus, SSE streaming, and REST control plane server.

---

## Overview

`@agent-monitor/server` handles all backend data persistence, real-time pub/sub distribution, and API routing. It embeds the Next.js static web control plane.

---

## Key Modules

- **`db/database.ts`**: Initializes Better-SQLite3 with `journal_mode = WAL`, foreign keys, and indexes.
- **`db/migrations/`**: Transactional migration runner executing schema migrations 001 to 006 on startup.
- **`db/repository.ts`**: `SessionRepository` providing atomic CRUD for sessions, chained events, approvals, authoritative kill switch, sticky MCP quarantine, policy versions, incidents, and tool fingerprints.
- **`bus.ts`**: In-memory `EventBus` for session-scoped pub/sub.
- **`app.ts`**: `MonitorServer` handling HTTP REST routes, SSE live stream (`/events/stream`), and static DevTools file serving with strict local-origin CORS validation.

---

## API Routes

| Route | Method | Description |
| :--- | :--- | :--- |
| `/health` | `GET` | Server health check. |
| `/policy` | `GET` | Active policies and defaults. |
| `/policy/evaluate` | `POST` | Dry-run policy evaluation. |
| `/policy/versions` | `GET` | List all immutable policy versions and active version. |
| `/policy/versions/active` | `GET` | Get currently active policy version. |
| `/policy/versions/diff` | `GET` | Compute diff between two policy versions. |
| `/policy/history` | `GET` | View policy mutation and activation history. |
| `/policy/versions/:id/activate` | `POST` | Activate a specific policy version. |
| `/policy/versions/:id/rollback` | `POST` | Roll back active policy to historical version. |
| `/policy/rules/:id/toggle` | `POST` | Toggle a policy rule enabled/disabled. |
| `/incidents` | `GET` / `POST` | List security incidents with filters or create an incident. |
| `/incidents/:id` | `GET` / `PATCH` | Get incident details or update status/notes. |
| `/incidents/:id/events` | `GET` | Retrieve correlated events for an incident. |
| `/mcp/sources` | `GET` | List registered downstream MCP sources and health. |
| `/mcp/sources/:id` | `GET` | Show MCP source runtime stats and quarantine details. |
| `/mcp/sources/:id/quarantine` | `POST` | Quarantine an untrusted MCP source. |
| `/mcp/sources/:id/trust` | `POST` | Lift quarantine on an MCP source. |
| `/audit/verify` | `GET` | Cryptographically verify SHA-256 event hash chain. |
| `/sessions/:id/risk-breakdown` | `GET` | Detailed multi-vector session risk explainability breakdown. |
| `/sessions` | `GET` / `POST` | List or create sessions. |
| `/sessions/:id` | `GET` | Get session details. |
| `/sessions/:id/events` | `GET` / `POST` | Historical events or insert new event. |
| `/sessions/:id/approvals` | `GET` | List approvals for session. |
| `/approvals/:id/approve` | `POST` | Atomically approve an action. |
| `/approvals/:id/deny` | `POST` | Atomically deny an action. |
| `/sessions/:id/kill` | `POST` | Authoritatively activate local Kill Switch. |
| `/sessions/:id/resume` | `POST` | Authoritatively resume killed session. |
| `/sessions/:id/control` | `GET` | Inspect kill switch status and session control state. |
| `/sessions/:id/tools` | `GET` | Inspect tool fingerprints & rug-pull mutation state. |
| `/sessions/:id/behavioral-matches` | `GET` | Retrieve detected behavioral exfiltration flows. |
| `/events/stream` | `GET` | Real-time Server-Sent Events (SSE) stream. |


---

## Installation

```bash
npm install @agent-monitor/server @agent-monitor/core
```
