# Getting Started with Agent Monitor

This guide will walk you from cloning the repository to running your first monitored, policy-controlled autonomous agent task.

---

## 1. System Requirements

- **Node.js**: `>= 20.0.0`
- **Operating System**: macOS, Linux, or Windows (WSL recommended)
- **API Key**: [DeepSeek API Key](https://platform.deepseek.com) (for running the reference coding agent)

---

## 2. Installation & Setup

### Step 1: Clone and install dependencies

```bash
git clone https://github.com/agentsentry/agentsentry.git
cd agentsentry
npm install
```

### Step 2: Build all packages & the web control plane

```bash
npm run build
```

This builds `@agent-monitor/core`, `@agent-monitor/server`, `@agent-monitor/agent`, `@agent-monitor/cli`, and compiles the Next.js static dashboard into `packages/server/public/`.

### Step 3: Configure your API Key

Add your DeepSeek API key to `.env` or export it in your shell:

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-api-key"
```

---

## 3. Bootstrap Configuration

Initialize a local `agent-monitor.config.json` in your workspace:

```bash
npm run cli -- config init
```

This generates:

```json
{
  "policy": {
    "default": "ALLOW"
  },
  "approval": {
    "timeoutMs": 300000
  },
  "rules": [
    {
      "id": "protect-environment-files",
      "name": "Protect Environment Files",
      "action": "file.*",
      "path": "**/.env*",
      "decision": "DENY",
      "reason": "Prevent AI agents from reading or modifying environment secrets."
    },
    {
      "id": "gate-git-push",
      "name": "Gate Remote Git Push",
      "action": "process.exec",
      "command": "git push *",
      "decision": "ASK",
      "reason": "Pushing code to remote repositories requires explicit human approval."
    }
  ]
}
```

Validate your configuration:

```bash
npm run cli -- config validate
```

---

## 4. Run Policy Simulator (Dry-Run Check)

Before running an agent, test how policies evaluate various actions without executing anything:

```bash
# Test a safe action (ALLOW)
npm run cli -- policy check --command "npm test"

# Test a gated action (ASK)
npm run cli -- policy check --command "git push origin main"

# Test a blocked action (DENY)
npm run cli -- policy check --action file.read --path ".env"
```

---

## 5. Run Your First Monitored Agent Task

### Safe Task (`ALLOW` path)

Run a task where all operations are safe:

```bash
npm run cli -- run --task "Read package.json and summarize the project dependencies"
```

**What you will see:**

1. Startup banner with active session ID and dashboard URL (`http://localhost:4040`).
2. Terminal activity stream displaying intercepted actions, risk scores, and duration.
3. Summary banner upon completion with action counts and overall risk.

### Gated Task (`ASK` path — Human Approval)

Run a task that attempts package installation or remote git operations:

```bash
npm run cli -- run --task "Install lodash and write a helper script" --keep-alive
```

**What happens:**

1. The agent evaluates `process.exec` with `npm install lodash`.
2. The Policy Engine triggers an **`ASK`** policy gate.
3. **Terminal:** Prompts:
   ```text
   ⚠️  HUMAN APPROVAL REQUIRED (V0.2 Policy Gate)
     Action:     process.exec
     Command:    npm install lodash
     Policy:     gate-dependency-install
     Allow this action? [y/n]:
   ```
4. **Web UI:** Open `http://localhost:4040`. The **Approval Modal** pops up with:
   - Full command preview
   - Policy reason
   - `[ DENY ]` and `[ ALLOW ONCE ]` buttons.
5. Choose your response:
   - Type `y` in the terminal **or** click **Allow Once** in the browser $\rightarrow$ command executes.
   - Type `n` in the terminal **or** click **Deny** in the browser $\rightarrow$ action is blocked with 0 command executions.

---

## 6. Explore Session History

List past recorded sessions directly from SQLite:

```bash
npm run cli -- sessions
```

Check system status and database storage:

```bash
npm run cli -- status
```

Open the standalone DevTools dashboard to inspect historical sessions:

```bash
npm run cli -- server
```

Visit **`http://localhost:4040`** to view file diffs, command outputs, timeline logs, and risk analytics.
