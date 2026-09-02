# `@agent-monitor/web`

Real-time developer control plane and DevTools dashboard for Agent Monitor.

---

## Overview

`@agent-monitor/web` is a Next.js 15 App Router web application that connects to the Monitor Server's SSE stream and SQLite database.

It is designed with an **Alabaster, Ink, and Burnt Terra Cotta** color palette and embeds directly into `@agent-monitor/server`'s static build.

---

## Key Components

- **`useSessionStream`**: React hook managing SSE connection, automatic reconnection, missed event recovery via `Last-Event-ID` / `afterSeq`, and REST approvals dispatch.
- **`ApprovalModal`**: Modal popup for reviewing and approving/denying `ASK` actions.
- **`Timeline`**: Interactive activity stream with status icons and category filters (`ALL`, `FILES`, `COMMANDS`, `ERRORS`, `HIGH RISK`).
- **`ActionDetail`**: Renders unified file diffs, execution output, and action parameters.

---

## Development

```bash
# Start Next.js development server on port 3000
npm run dev:web

# Build static HTML export (copied to packages/server/public)
npm run build:web
```
