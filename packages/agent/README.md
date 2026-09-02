# `@agent-monitor/agent`

Action interception, security guardrails, safe tool definitions, approval management, and reference DeepSeek autonomous agent runtime.

---

## Overview

`@agent-monitor/agent` sits between the AI model and the operating system. It provides the runtime interception harness, containment guardrails, safe tools, and the DeepSeek client implementation.

---

## Key Modules

- **`ActionInterceptor`**:
  - Intercepts tool calls before execution.
  - Enforces workspace containment and symlink checks.
  - Evaluates policies and coordinates human approval.
  - Emits strictly sequenced audit events.
- **`ApprovalManager`**:
  - Manages pending approval requests.
  - Handles asynchronous resolution and expiration timeouts.
- **`tools/`**:
  - Safe tools: `readFileTool`, `writeFileTool`, `listFilesTool`, `runCommandTool`.
  - Guardrails: `resolveSafeWorkspacePath`.
- **`deepseek/`**:
  - `DeepSeekClient`: Lightweight HTTP client for DeepSeek Chat API.
  - `DeepSeekCodingAgent`: Reference autonomous coding agent loop.

---

## Installation

```bash
npm install @agent-monitor/agent @agent-monitor/core
```

---

## Example Usage

```typescript
import {
  ActionInterceptor,
  readFileTool,
  writeFileTool,
  runCommandTool,
} from "@agent-monitor/agent";
import { PolicyEngine } from "@agent-monitor/core";

const interceptor = new ActionInterceptor({
  sink: {
    emit: async (event) => console.log("Event:", event.type),
  },
  policyEngine: new PolicyEngine(),
});

interceptor.registerTool(readFileTool);
interceptor.registerTool(writeFileTool);
interceptor.registerTool(runCommandTool);

const output = await interceptor.invoke(
  "read_file",
  { path: "package.json" },
  {
    sessionId: "ses_123",
    agentId: "my-agent",
    workspaceRoot: process.cwd(),
  },
);
```
