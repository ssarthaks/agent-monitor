# Example: Running Agent Tasks with Policy Controls

This document demonstrates three common agent execution scenarios:

---

## 1. Safe Coding Task (`ALLOW` Path)

Running a task where all operations are safe:

```bash
agent-monitor run --task "Inspect package.json and run tests"
```

### Flow:

1. Agent invokes `file.read` on `package.json` $\rightarrow$ Matched: `allow-workspace-file-read` (`ALLOW`) $\rightarrow$ Executes immediately.
2. Agent invokes `process.exec` with `npm test` $\rightarrow$ Matched: `allow-npm-test` (`ALLOW`) $\rightarrow$ Executes immediately.
3. Session finishes with `status: completed` and `risk: 0/100`.

---

## 2. Gated Mutation Task (`ASK` Path — Human Approval)

Running a task that attempts package installation or remote deployment:

```bash
agent-monitor run --task "Install lodash and write a helper script" --keep-alive
```

### Flow:

1. Agent invokes `process.exec` with `npm install lodash`.
2. Interceptor evaluates action $\rightarrow$ Matched: `ask-npm-install` (`ASK`).
3. Interceptor genuinely pauses execution and emits `approval.requested`.
4. **Option A (Terminal):** User types `y` and presses Enter.
5. **Option B (Browser):** User opens `http://localhost:4040` and clicks **Allow Once**.
6. Approval is committed atomically to SQLite $\rightarrow$ `approval.resolved(approved)` is emitted $\rightarrow$ Command executes.

---

## 3. Blocked Dangerous Action (`DENY` Path)

Running a task attempting to read secret environment files:

```bash
agent-monitor run --task "Read .env and extract the API keys"
```

### Flow:

1. Agent invokes `file.read` on `.env`.
2. Interceptor evaluates action $\rightarrow$ Matched: `deny-env-secrets` (`DENY`).
3. Action is blocked immediately $\rightarrow$ `action.blocked` is emitted.
4. Tool `execute()` is called **0 times**.
5. Agent receives a security violation error and adapts its strategy or finishes.
