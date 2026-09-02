import { describe, it, expect, beforeEach } from "vitest";
import { DeepSeekCodingAgent } from "../src/deepseek/agent.js";
import {
  DeepSeekClient,
  ChatCompletionResponse,
} from "../src/deepseek/client.js";
import { ActionInterceptor } from "../src/interceptor.js";
import { readFileTool } from "../src/tools/file-read.js";
import { listFilesTool } from "../src/tools/file-list.js";
import { AgentEvent } from "@agent-monitor/core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("DeepSeekCodingAgent with Mock API", () => {
  let emittedEvents: AgentEvent[];
  let interceptor: ActionInterceptor;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mock-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "mock-app" }),
    );

    emittedEvents = [];
    interceptor = new ActionInterceptor({
      emit: async (ev) => {
        emittedEvents.push(ev);
      },
    });

    interceptor.registerTool(readFileTool);
    interceptor.registerTool(listFilesTool);
  });

  it("executes agent loop with parallel tool calls and emits events and visible messages", async () => {
    let callCount = 0;

    const mockClient = {
      createChatCompletion: async (): Promise<ChatCompletionResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            id: "mock_resp_1",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content:
                    "I will list the workspace files and read package.json.",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "list_files",
                        arguments: JSON.stringify({ recursive: false }),
                      },
                    },
                    {
                      id: "call_2",
                      type: "function",
                      function: {
                        name: "read_file",
                        arguments: JSON.stringify({ path: "package.json" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 150,
              completion_tokens: 50,
              total_tokens: 200,
              prompt_cache_hit_tokens: 50,
              prompt_cache_miss_tokens: 100,
            },
          };
        }

        return {
          id: "mock_resp_2",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content:
                  "I have finished inspecting the project. The package name is mock-app.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 300,
            completion_tokens: 100,
            total_tokens: 400,
            prompt_cache_hit_tokens: 200,
            prompt_cache_miss_tokens: 100,
          },
        };
      },
    } as unknown as DeepSeekClient;

    const agent = new DeepSeekCodingAgent({
      client: mockClient,
      interceptor,
      context: {
        sessionId: "ses_mock_1",
        agentId: "deepseek-coding-agent",
        workspaceRoot: tmpDir,
      },
    });

    await agent.run("Inspect project");

    expect(callCount).toBe(2);

    const messages = emittedEvents.filter((e) => e.type === "agent.message");
    const starts = emittedEvents.filter((e) => e.type === "action.started");
    const completes = emittedEvents.filter(
      (e) => e.type === "action.completed",
    );

    expect(messages.length).toBe(2);
    expect(starts.length).toBe(2);
    expect(completes.length).toBe(2);

    const usage = agent.getUsage();
    expect(usage.promptTokens).toBe(450);
    expect(usage.completionTokens).toBe(150);
    expect(usage.totalTokens).toBe(600);
    expect(usage.cacheHitTokens).toBe(250);
    expect(usage.cacheMissTokens).toBe(200);
    expect(usage.estimatedCostUsd).toBeGreaterThan(0);
  });
});
