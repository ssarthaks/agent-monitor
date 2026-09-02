# Agent Monitor (v0.1)

> **Chrome DevTools & Activity Monitor for AI Agents** — An open-source local control plane providing real-time observability, action timelines, unified file diffs, command inspection, and deterministic risk analysis for autonomous AI coding agents.

---

## 🌟 Key Features

1. **Action-Centric Activity Timeline**: Real-time event stream capturing file reads, file writes, directory listings, command executions, and errors.
2. **Visual Diff & Terminal Inspector**: Side-by-side unified file diffs with syntax highlighting and dark-theme terminal runner output with exit codes.
3. **Deterministic, Explainable Risk Engine**: Scored rule matching (0–100) flagging `.env` file access, SSH private keys, `rm -rf` destructive commands, privilege escalation (`sudo`), outbound exfiltration (`curl`), and path traversal attempts.
4. **Safe Workspace Containment & Guardrails**: Path normalization (`path.relative` + `fs.realpathSync` symlink checks), 2MB file size limits, 30s command timeouts, and bounded 100KB stdout/stderr buffers.
5. **SQLite WAL Persistence as Single Source of Truth**: Instant session recovery upon page refresh or reconnection; live SSE synchronization.
6. **Reference DeepSeek Coding Agent**: Autonomous ReAct loop with parallel tool call execution via `Promise.all` and clean agent message output.

---

## 🏗️ Monorepo Architecture

```text
packages/
├── core/       # Action & event domain schemas, types, and deterministic Risk Analyzer
├── server/     # better-sqlite3 WAL database, session repository, EventBus, SSE & HTTP server
├── agent/      # Tool implementations, security guardrails, ActionInterceptor, DeepSeek ReAct agent
└── cli/        # `agent-monitor run` CLI binary with real-time ANSI stream & summary banner

apps/
└── web/        # Next.js 15 App Router + Tailwind CSS DevTools dashboard
```

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

---

## 🧪 Testing

Run the full automated test suite (25 tests across Core, Server, and Agent packages):

```bash
npm test
```

---

## ⚠️ Safety Notice

Agent Monitor V0.1 provides activity monitoring, deterministic risk analysis, and application-level guardrails (timeout, bounded buffers, workspace containment). **Host shell command execution (`process.exec`) is NOT an OS-level sandbox.**
