export interface AIModel {
  id: string;
  name: string;
  description?: string;
  availability?: string;
  deprecated?: boolean;
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
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
  };
  reasoning?: {
    enabled: boolean;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    verbosity?: 'low' | 'medium' | 'high';
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: any;
}
