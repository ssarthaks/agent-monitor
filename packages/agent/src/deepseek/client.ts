export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;
  temperature?: number;
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class DeepSeekClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl: string = 'https://api.deepseek.com') {
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.apiKey) {
      throw new Error(
        'DeepSeek API key is missing. Please set the DEEPSEEK_API_KEY environment variable.'
      );
    }

    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`DeepSeek API error (${res.status} ${res.statusText}): ${errorText}`);
    }

    return (await res.json()) as ChatCompletionResponse;
  }
}
