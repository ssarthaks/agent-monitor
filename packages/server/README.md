# `@agent-monitor/server`

Local SQLite WAL persistence, atomic approval resolution, in-memory EventBus, SSE streaming, and REST control plane server.

---

## Overview

`@agent-monitor/server` handles all backend data persistence, real-time pub/sub distribution, and API routing. It embeds the Next.js static web control plane.

---

## Key Modules

- **`db/database.ts`**: Initializes Better-SQLite3 with `journal_mode = WAL` and foreign keys.
- **`db/repository.ts`**: `SessionRepository` providing atomic CRUD for sessions, events, and approvals.
- **`bus.ts`**: In-memory `EventBus` for session-scoped pub/sub.
- **`app.ts`**: `MonitorServer` handling HTTP REST routes, SSE live stream (`/events/stream`), and static DevTools file serving.

---

## API Routes

| Route                     | Method         | Description                                |
| :------------------------ | :------------- | :----------------------------------------- |
| `/health`                 | `GET`          | Server health check.                       |
| `/policy`                 | `GET`          | Active policies and defaults.              |
| `/policy/evaluate`        | `POST`         | Dry-run policy evaluation.                 |
| `/sessions`               | `GET` / `POST` | List or create sessions.                   |
| `/sessions/:id`           | `GET`          | Get session details.                       |
| `/sessions/:id/events`    | `GET` / `POST` | Historical events or insert new event.     |
| `/sessions/:id/approvals` | `GET`          | List approvals for session.                |
| `/approvals/:id/approve`  | `POST`         | Atomically approve an action.              |
| `/approvals/:id/deny`     | `POST`         | Atomically deny an action.                 |
| `/events/stream`          | `GET`          | Real-time Server-Sent Events (SSE) stream. |

---

## Installation

```bash
npm install @agent-monitor/server @agent-monitor/core
```
