import { AgentRuntime, ToolExecutionContext } from "../runtime.js";
import { ActionInterceptor } from "../interceptor.js";
import { DeepSeekClient, ChatMessage } from "./client.js";
import { DEEPSEEK_SYSTEM_PROMPT } from "./prompts.js";
import { TokenUsage } from "@agent-monitor/core";

export interface DeepSeekAgentOptions {
  client?: DeepSeekClient;
  interceptor: ActionInterceptor;
  context: ToolExecutionContext;
  model?: string;
  maxSteps?: number;
}

export class DeepSeekCodingAgent implements AgentRuntime {
  readonly agentId = "deepseek-coding-agent";
  readonly agentName = "DeepSeek Coding Agent";
  readonly provider = "deepseek";
  readonly model: string;

  private client: DeepSeekClient;
  private interceptor: ActionInterceptor;
  private context: ToolExecutionContext;
  private maxSteps: number;

  private usage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    estimatedCostUsd: 0,
  };

  constructor(options: DeepSeekAgentOptions) {
    this.client = options.client || new DeepSeekClient();
    this.interceptor = options.interceptor;
    this.context = options.context;
    this.model = options.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
    this.maxSteps = options.maxSteps || 25;
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  async run(task: string): Promise<void> {
    const messages: ChatMessage[] = [
      { role: "system", content: DEEPSEEK_SYSTEM_PROMPT },
      { role: "user", content: task },
    ];

    const tools = this.interceptor.getToolDefinitions().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    let step = 0;

    while (step < this.maxSteps) {
      step++;

      const response = await this.client.createChatCompletion({
        model: this.model,
        messages,
        tools,
        temperature: 0.1,
      });

      let turnUsage: TokenUsage | undefined = undefined;

      if (response.usage) {
        const u = response.usage;
        const promptTokens = u.prompt_tokens || 0;
        const completionTokens = u.completion_tokens || 0;
        const totalTokens = u.total_tokens || promptTokens + completionTokens;

        const hit =
          u.prompt_cache_hit_tokens ??
          u.prompt_tokens_details?.cached_tokens ??
          0;
        const miss =
          u.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - hit);

        if (this.usage.cacheHitTokens !== undefined)
          this.usage.cacheHitTokens += hit;
        if (this.usage.cacheMissTokens !== undefined)
          this.usage.cacheMissTokens += miss;

        this.usage.promptTokens += promptTokens;
        this.usage.completionTokens += completionTokens;
        this.usage.totalTokens += totalTokens;

        // Pricing: Cache Miss: $0.14/M ($0.00000014/tok), Cache Hit: $0.014/M ($0.000000014/tok), Output: $0.28/M ($0.00000028/tok)
        const stepCost =
          miss * 0.00000014 + hit * 0.000000014 + completionTokens * 0.00000028;

        this.usage.estimatedCostUsd += stepCost;

        turnUsage = {
          promptTokens,
          completionTokens,
          totalTokens,
          cacheHitTokens: hit,
          cacheMissTokens: miss,
          estimatedCostUsd: stepCost,
        };
      }

      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error("Received empty response from DeepSeek API");
      }

      const message = choice.message;
      messages.push(message);

      if (message.content && message.content.trim()) {
        await this.interceptor.emitAgentMessage(
          this.context.sessionId,
          this.agentId,
          message.content,
          turnUsage,
          step,
        );
      } else if (
        turnUsage &&
        message.tool_calls &&
        message.tool_calls.length > 0
      ) {
        await this.interceptor.emitAgentMessage(
          this.context.sessionId,
          this.agentId,
          `Executing ${message.tool_calls.length} tool action(s)...`,
          turnUsage,
          step,
        );
      }

      if (!message.tool_calls || message.tool_calls.length === 0) {
        break;
      }

      const toolResults = await Promise.all(
        message.tool_calls.map(async (call) => {
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = JSON.parse(call.function.arguments || "{}");
          } catch (err: any) {
            return {
              role: "tool" as const,
              tool_call_id: call.id,
              content: `Invalid JSON arguments: ${err.message}`,
            };
          }

          try {
            const result = await this.interceptor.invoke(
              call.function.name,
              parsedArgs,
              this.context,
            );

            return {
              role: "tool" as const,
              tool_call_id: call.id,
              content:
                typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2),
            };
          } catch (err: any) {
            return {
              role: "tool" as const,
              tool_call_id: call.id,
              content: `ERROR: ${err.message}`,
            };
          }
        }),
      );

      for (const res of toolResults) {
        messages.push(res);
      }
    }
  }
}
