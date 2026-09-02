# Development Guide & Contributing

This guide explains how to set up the local developer environment, build the monorepo, and contribute new capabilities to Agent Monitor.

---

## 1. Monorepo Structure

Agent Monitor uses npm workspaces:

```text
packages/
  core/    - @agent-monitor/core   (Domain models, Risk Engine, Policy Engine)
  server/  - @agent-monitor/server (SQLite database, Repository, EventBus, SSE)
  agent/   - @agent-monitor/agent  (Interceptor, Guardrails, Tools, DeepSeek)
  cli/     - @agent-monitor/cli    (CLI binary commands)
apps/
  web/     - @agent-monitor/web    (Next.js DevTools control plane)
```

---

## 2. Common Development Scripts

```bash
# Install all dependencies
npm install

# Build all TypeScript packages & Next.js static export
npm run build

# Build only the web dashboard and copy export to server/public
npm run build:web

# Run all test suites
npm test

# Run the CLI directly from source using tsx
npm run cli -- <command>

# Start the web dashboard in development mode (hot reloading)
npm run dev:web
```

---

## 3. Adding a New Policy Rule

To add a new default policy rule:

1. Open [`packages/core/src/policy/defaults.ts`](../packages/core/src/policy/defaults.ts).
2. Add your rule to `DEFAULT_POLICY_RULES`:
   ```typescript
   {
     id: 'deny-aws-credentials',
     action: 'file.*',
     path: '~/.aws/**',
     decision: 'DENY',
     reason: 'Access to AWS credentials is prohibited.',
   }
   ```
3. Add a test in [`packages/core/test/policy-engine.test.ts`](../packages/core/test/policy-engine.test.ts).

---

## 4. Adding a New Safe Tool

To add a new safe tool for agents:

1. Open [`packages/agent/src/tools/`](../packages/agent/src/tools/).
2. Define your tool conforming to `ToolDefinition`:
   ```typescript
   export const myTool: ToolDefinition = {
     name: "my_tool",
     actionKind: "custom.action",
     category: "custom",
     description: "Description for LLM",
     parameters: {
       /* JSON Schema */
     },
     execute: async (params, ctx) => {
       // Implementation
     },
   };
   ```
3. Register the tool in `ActionInterceptor` or `DeepSeekCodingAgent`.
4. Add unit tests in [`packages/agent/test/tools.test.ts`](../packages/agent/test/tools.test.ts).
