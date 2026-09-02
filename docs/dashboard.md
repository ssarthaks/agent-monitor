# Web DevTools Dashboard Guide

Agent Monitor embeds a developer control plane built with Next.js 15, styled in an **Alabaster, Ink, and Burnt Terra Cotta** design system.

---

## 1. Starting the Dashboard

The dashboard is served directly by the Monitor Server:

```bash
# Start standalone server
agent-monitor server

# Or automatically hosted during an agent run with --keep-alive
agent-monitor run --task "..." --keep-alive
```

Visit: **`http://localhost:4040`**

---

## 2. Key Dashboard Features

### A. Real-Time Activity Stream

- Left-hand panel tails events live via SSE (`/events/stream?sessionId=...`).
- Filter stream by: `ALL`, `FILES`, `COMMANDS`, `ERRORS`, or `HIGH RISK`.
- Status icons indicate action state:
  - 🟢 **Completed / Executing**
  - 🟡 **Waiting for Human Approval**
  - 🔴 **Blocked by Policy / Denied**
  - ⚪ **Failed with Error**

### B. Interactive Human Approval Modal

When an action hits an `ASK` policy:

- The dashboard pops up the **Approval Modal**.
- Displays: Action kind, Command/Path, Risk level badge, and Policy Reason.
- Provides **`[ DENY ]`** and **`[ ALLOW ONCE ]`** buttons.
- Clicking either button sends an atomic `POST /approvals/:id/approve` or `deny` request to SQLite.
- Upon resolution, the modal closes and the activity stream updates in real-time.

### C. Unified File Diff Inspector

- When `file.write` executes, the right-hand panel renders a side-by-side or unified diff showing exact additions and deletions.
- Tracks total lines changed and bytes written.

### D. Process Output Viewer

- For `process.exec` actions, displays full stdout/stderr with syntax highlighting and exit codes.

### E. Session Selector & Historical Replay

- The top header includes a session dropdown selector.
- Select any historical session to reconstruct its complete timeline, metrics, risk scores, and diffs from SQLite.
