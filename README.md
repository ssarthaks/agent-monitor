# Agent Monitor (v0.1.3)

> **Chrome DevTools & Activity Monitor for AI Agents** — An open-source local control plane providing real-time observability, action timelines, unified file diffs, command inspection, and deterministic risk analysis for autonomous AI coding agents.

---

## 🌟 Key Features

1. **Action-Centric Activity Timeline**: Real-time event stream capturing file reads, file writes, directory listings, command executions, and errors.
2. **Visual Diff & Terminal Inspector**: Side-by-side unified file diffs with syntax highlighting and dark-theme terminal runner output with exit codes.
3. **Deterministic, Explainable Risk Engine**: Scored rule matching (0–100) flagging `.env` file access, SSH private keys, `rm -rf` destructive commands, privilege escalation (`sudo`), outbound exfiltration (`curl`), and path traversal attempts.
4. **Safe Workspace Containment & Guardrails**: Path normalization (`path.relative` + `fs.realpathSync` symlink checks), 2MB file size limits, 30s command timeouts, and bounded 100KB stdout/stderr buffers.
5. **SQLite WAL Persistence as Single Source of Truth**: Instant session recovery upon page refresh or reconnection; live SSE synchronization.
6. **Reference DeepSeek Coding Agent**: Autonomous ReAct loop with parallel tool call execution via `Promise.all` and clean agent message output.
7. **Multi-Session Dashboard**: Browse and switch between past sessions, inspect per-session risk scores, and export full session history (session + events) as JSON.

---

## 🏗️ Monorepo Architecture

```text
packages/
├── core/       # Action & event domain schemas, types, and deterministic Risk Analyzer
├── server/     # better-sqlite3 WAL database, session repository, EventBus, SSE & HTTP server
├── agent/      # Tool implementations, security guardrails, ActionInterceptor, DeepSeek ReAct agent
└── cli/        # `agent-monitor` CLI binary with real-time ANSI stream & summary banner

apps/
└── web/        # Next.js 15 App Router + Tailwind CSS DevTools dashboard
```

### Package Scripts (root)

| Command | Description |
| --- | --- |
| `npm run dev:web` | Start the Next.js dashboard in development mode |
| `npm run cli -- <args>` | Run the CLI via `tsx` (no build required) |
| `npm test` | Run the full Vitest suite (25 tests across Core, Server, Agent) |
| `npm run build` | Build the web dashboard and all packages |
| `npm run build:web` | Build the web dashboard and copy static output into `packages/server/public` |
| `npm run publish:packages` | Publish `core`, `server`, `agent`, and `cli` to npm |

---

## 🚀 Quick Start

### 1. Configure Environment

Create `.env.local` in the project root (or copy `.env.sample`):

```bash
cp .env.sample .env.local
```

Add your DeepSeek API key:

```env
DEEPSEEK_API_KEY="your-deepseek-api-key"
DEEPSEEK_MODEL="deepseek-chat"
```

### 2. Start the Live DevTools Dashboard (Terminal 1)

```bash
npm run dev:web
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 3. Run Agent Task with Activity Monitoring (Terminal 2)

```bash
npm run cli -- run --task "Inspect this project, examine package.json, and run automated tests"
```

Or target a specific workspace:

```bash
npm run cli -- run --task "Fix bugs in src/ and test" --workspace /path/to/project
```

The `run` command automatically starts the monitor server (or reuses one already running on the port), streams live events to the terminal, and prints a summary banner when the agent finishes.

---

## 🖥️ CLI Reference

The CLI exposes two subcommands: `run` (run an agent with monitoring) and `server` (standalone background monitor service).

### `agent-monitor run`

Run an autonomous coding agent with real-time activity monitoring and guardrails.

| Option | Description | Default |
| --- | --- | --- |
| `-t, --task <task>` | The task or prompt for the agent to execute | *(required)* |
| `-w, --workspace <path>` | Workspace directory path | current working directory |
| `-p, --port <port>` | Monitor Server API port | `4040` |
| `--web-port <port>` | Dashboard web port | `3000` |
| `--model <model>` | DeepSeek model name | `deepseek-chat` |
| `--db <path>` | Custom SQLite database file path | `.agent-monitor/data.db` |
| `--keep-alive` | Keep the monitor server running after the agent task finishes | off |

```bash
npm run cli -- run --task "Refactor the API layer and run tests" \
  --workspace ./my-project \
  --keep-alive
```

### `agent-monitor server`

Start the standalone Monitor Server to serve SQLite session history and live SSE.

| Option | Description | Default |
| --- | --- | --- |
| `-p, --port <port>` | Monitor Server API port | `4040` |
| `-w, --workspace <path>` | Workspace directory path | current working directory |
| `--db <path>` | Custom SQLite database file path | `.agent-monitor/data.db` |

```bash
npm run cli -- server --port 4040
```

---

## 🔌 Monitor Server API

The monitor server (default `http://127.0.0.1:4040`) exposes a small HTTP + SSE API:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/health` | GET | Health check returning `{ status: "ok" }` |
| `/sessions` | GET | List recent sessions (`?limit=`) |
| `/sessions` | POST | Create a new session |
| `/sessions/:id` | GET | Fetch a single session |
| `/sessions/:id/events` | GET | Fetch events (`?afterSeq=`) |
| `/sessions/:id/events` | POST | Insert an event |
| `/events/stream?sessionId=:id` | GET | Live SSE event stream (supports `Last-Event-ID` / `afterSeq` replay) |

The server also serves the exported static dashboard UI when a build is present.

---

## ⚙️ Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API key (required to run the agent) | — |
| `DEEPSEEK_MODEL` | DeepSeek model name | `deepseek-chat` |
| `AGENT_MONITOR_PORT` | Monitor Server API port | `4040` |
| `AGENT_MONITOR_HOST` | Monitor Server bind host | `127.0.0.1` |
| `PORT` | Web dashboard port | `3000` |
| `NEXT_PUBLIC_SERVER_URL` | Base URL the dashboard uses to reach the monitor server | `http://127.0.0.1:4040` |

---

## 🧪 Testing

Run the full automated test suite (25 tests across Core, Server, and Agent packages):

```bash
npm test
```

---

## ⚠️ Safety Notice

Agent Monitor provides activity monitoring, deterministic risk analysis, and application-level guardrails (timeout, bounded buffers, workspace containment). **Host shell command execution (`process.exec`) is NOT an OS-level sandbox.** Run the agent only in workspaces you trust and are prepared to have modified.
