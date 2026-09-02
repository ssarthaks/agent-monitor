# Agent Runtime & Provider Independence

Agent Monitor is strictly **provider-agnostic**. The core monitoring, risk, and policy architectures are completely decoupled from specific AI/LLM providers.

---

## 1. Provider-Agnostic Boundary

```text
┌────────────────────────────────────────────────────────┐
│                  @agent-monitor/core                   │
│   (Domain Models, Risk Engine, Policy Engine, Events)  │
│   ──► ZERO LLM Dependencies                            │
│   ──► ZERO Provider Code                               │
└───────────────────────────▲────────────────────────────┘
                            │
┌───────────────────────────┴────────────────────────────┐
│                  @agent-monitor/agent                  │
│                                                        │
│   ┌────────────────────────────────────────────────┐   │
│   │ ActionInterceptor (Intercepts any tool call)   │   │
│   └───────────────────────▲────────────────────────┘   │
│                           │                            │
│   ┌───────────────────────┴────────────────────────┐   │
│   │ DeepSeekCodingAgent (Reference Implementation) │   │
│   │ - DeepSeekClient (OpenAI-compatible HTTP client│   │
│   │ - Prompt Loop & Tool Call Dispatcher           │   │
│   └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

---

## 2. Reference Implementation: DeepSeek Coding Agent

Agent Monitor includes a reference coding agent implementation in `@agent-monitor/agent/src/deepseek/`:

- **`DeepSeekClient`**: Lightweight, zero-dependency HTTP client communicating with DeepSeek's OpenAI-compatible Chat Completions API (`https://api.deepseek.com/chat/completions`).
- **`DeepSeekCodingAgent`**: Autonomous agent that receives a user task, inspects the codebase using tools, makes code modifications, runs tests, and explains its reasoning.

### Agent Execution Loop:

1. Emits `session.started`.
2. Sends system prompt, available tool schemas, and conversation history to DeepSeek.
3. If the model responds with `tool_calls`, dispatches each call through `ActionInterceptor.invoke()`.
4. Feeds tool results back into the conversation context.
5. If the model responds with text, emits `agent.message`.
6. Concludes by emitting `session.ended` with computed summary metrics.

---

## 3. Integrating Custom Agent Frameworks

You can monitor any custom agent framework (e.g. LangChain, AutoGen, custom LLM loops) by routing tool invocations through the `ActionInterceptor`:

```typescript
import {
  ActionInterceptor,
  readFileTool,
  writeFileTool,
  runCommandTool,
} from "@agent-monitor/agent";
import {
  SessionRepository,
  EventBus,
  createDatabase,
} from "@agent-monitor/server";
import { PolicyEngine } from "@agent-monitor/core";

// 1. Setup backend
const db = createDatabase("./.agent-monitor/data.db");
const repository = new SessionRepository(db);
const eventBus = new EventBus();

// 2. Setup Interceptor
const interceptor = new ActionInterceptor({
  sink: {
    emit: async (event) => {
      repository.insertEvent(event);
      eventBus.publish(event);
    },
  },
  policyEngine: new PolicyEngine(),
});

interceptor.registerTool(readFileTool);
interceptor.registerTool(writeFileTool);
interceptor.registerTool(runCommandTool);

// 3. Invoke within your custom agent
const result = await interceptor.invoke(
  "read_file",
  { path: "src/main.ts" },
  {
    sessionId: "ses_custom_1",
    agentId: "my-custom-agent",
    workspaceRoot: process.cwd(),
  },
);
```
