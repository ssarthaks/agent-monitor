import { AgentRuntime, ToolExecutionContext } from '../runtime.js';
import { ActionInterceptor } from '../interceptor.js';
import { DeepSeekClient, ChatMessage } from './client.js';
import { DEEPSEEK_SYSTEM_PROMPT } from './prompts.js';

export interface DeepSeekAgentOptions {
  client?: DeepSeekClient;
  interceptor: ActionInterceptor;
  context: ToolExecutionContext;
  model?: string;
  maxSteps?: number;
}

export class DeepSeekCodingAgent implements AgentRuntime {
  readonly agentId = 'deepseek-coding-agent';
  readonly agentName = 'DeepSeek Coding Agent';
  readonly provider = 'deepseek';
  readonly model: string;

  private client: DeepSeekClient;
  private interceptor: ActionInterceptor;
  private context: ToolExecutionContext;
  private maxSteps: number;

  constructor(options: DeepSeekAgentOptions) {
    this.client = options.client || new DeepSeekClient();
    this.interceptor = options.interceptor;
    this.context = options.context;
    this.model = options.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.maxSteps = options.maxSteps || 25;
  }

  async run(task: string): Promise<void> {
    const messages: ChatMessage[] = [
      { role: 'system', content: DEEPSEEK_SYSTEM_PROMPT },
      { role: 'user', content: task },
    ];

    const tools = this.interceptor.getToolDefinitions().map((t) => ({
      type: 'function' as const,
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

      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error('Received empty response from DeepSeek API');
      }

      const message = choice.message;
      messages.push(message);

      if (message.content && message.content.trim()) {
        await this.interceptor.emitAgentMessage(
          this.context.sessionId,
          this.agentId,
          message.content
        );
      }

      if (!message.tool_calls || message.tool_calls.length === 0) {
        break;
      }

      const toolResults = await Promise.all(
        message.tool_calls.map(async (call) => {
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = JSON.parse(call.function.arguments || '{}');
          } catch (err: any) {
            return {
              role: 'tool' as const,
              tool_call_id: call.id,
              content: `Invalid JSON arguments: ${err.message}`,
            };
          }

          try {
            const result = await this.interceptor.invoke(
              call.function.name,
              parsedArgs,
              this.context
            );

            return {
              role: 'tool' as const,
              tool_call_id: call.id,
              content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            };
          } catch (err: any) {
            return {
              role: 'tool' as const,
              tool_call_id: call.id,
              content: `ERROR: ${err.message}`,
            };
          }
        })
      );

      for (const res of toolResults) {
        messages.push(res);
      }
    }
  }
}
