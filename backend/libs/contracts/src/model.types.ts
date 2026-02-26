export interface AIModel {
  id: string;
  name: string;
  provider:
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'local'
    | 'deepseek'
    | 'mistral'
    | 'meta'
    | 'alibaba'
    | 'moonshot'
    | 'baichuan'
    | 'zhipu'
    | 'xunfei'
    | 'minimax'
    | 'microsoft';
  model: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: any;
}
