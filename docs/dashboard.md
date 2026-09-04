# Web Control Plane & DevTools Dashboard (V4.0.0)

Agent Monitor embeds a production-grade control plane and security operations dashboard built with Next.js 15, styled in an **Alabaster, Ink, and Burnt Terra Cotta** design system.

---

## 1. Starting the Dashboard

The dashboard is served directly by the Monitor Server binary without external web servers:

```bash
# Start standalone control plane server
agent-monitor server

# Or automatically hosted during an agent run with --keep-alive
agent-monitor run --task "..." --keep-alive
```

Visit: **`http://localhost:4040`**

---

## 2. Navigation & Views

The top navigation header provides instant access to four core control plane views:

### A. Timeline View

- **Real-Time Activity Stream**: Left-hand panel tails events live via SSE (`/events/stream?sessionId=...`).
- **Stream Filtering**: Filter stream by `ALL`, `FILES`, `COMMANDS`, `ERRORS`, or `HIGH RISK`.
- **Action Diffs & Output**: Right-hand inspector renders side-by-side or unified diffs for `file.write` and syntax-highlighted stdout/stderr for `process.exec`.
- **Interactive Human Approval Modal**: Pops up instantly when an action triggers an `ASK` policy, providing `[ DENY ]` and `[ ALLOW ONCE ]` controls backed by atomic SQLite concurrency.
- **Session Replay**: Switch between historical sessions from the header dropdown to reconstruct complete execution lifecycles.

### B. Incidents View (Security Operations)

- **Incident Case Registry**: Live table of all security incidents automatically or manually created across sessions.
- **Severity & Status Badging**: Displays severity badges (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) and lifecycle status (`OPEN`, `INVESTIGATING`, `CONTAINED`, `RESOLVED`, `FALSE_POSITIVE`).
- **Interactive Status Transitions**: One-click actions to investigate, contain, or resolve incidents.
- **Correlated Forensic Events**: Inspect chronological audit events directly tied to the incident root cause.

### C. MCP Sources View (Downstream Isolation)

- **Registered Server Registry**: Inspect all downstream Model Context Protocol servers communicating through the gateway.
- **Health Diagnostics**: Real-time tracking of request counts, error counts, discovered tools, and last active timestamps.
- **Quarantine Controls**: One-click **`Quarantine Source`** button to immediately isolate rogue or mutating servers.
- **Trust Lifting**: One-click **`Trust Source`** button to lift quarantine restrictions and re-enable tool execution.

### D. Policies View (Versioning & Rollback)

- **Version History**: Chronological list of all immutable policy versions with author, creation timestamp, and SHA-256 hash.
- **Active Version Indicator**: Highlights the currently enforced policy version.
- **Instant Rollback**: One-click **`Activate Version`** button to safely roll back or swap active policy versions in real time without restarting servers.
- **Dynamic Rule Toggles**: Toggle individual policy rules enabled/disabled directly from the UI, automatically creating a new version.

