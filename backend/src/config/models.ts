import { AIModel } from '../shared/types';

export const AVAILABLE_MODELS: AIModel[] = [
  // ============================================================
  // OpenAI Models
  // ============================================================
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    model: 'gpt-4',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    model: 'gpt-4.1',
    maxTokens: 32768,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    maxTokens: 32768,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gpt-4.1-nano',
    name: 'GPT-4.1 Nano',
    provider: 'openai',
    model: 'gpt-4.1-nano',
    maxTokens: 32768,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    model: 'gpt-3.5-turbo',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    model: 'gpt-5',
    maxTokens: 32768,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    provider: 'openai',
    model: 'gpt-5-mini',
    maxTokens: 32768,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'o1-preview',
    name: 'o1 Preview',
    provider: 'openai',
    model: 'o1-preview',
    maxTokens: 32768,
    temperature: 1,
    topP: 1,
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini',
    provider: 'openai',
    model: 'o1-mini',
    maxTokens: 65536,
    temperature: 1,
    topP: 1,
  },
  {
    id: 'o3',
    name: 'o3',
    provider: 'openai',
    model: 'o3',
    maxTokens: 32768,
    temperature: 1,
    topP: 1,
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    provider: 'openai',
    model: 'o3-mini',
    maxTokens: 65536,
    temperature: 1,
    topP: 1,
  },
  {
    id: 'o4-mini',
    name: 'o4 Mini',
    provider: 'openai',
    model: 'o4-mini',
    maxTokens: 65536,
    temperature: 1,
    topP: 1,
  },

  // ============================================================
  // Anthropic Models
  // ============================================================
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    maxTokens: 128000,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 64000,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    maxTokens: 64000,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    provider: 'anthropic',
    model: 'claude-opus-4-5',
    maxTokens: 64000,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    maxTokens: 64000,
    temperature: 0.7,
    topP: 1,
  },

  // ============================================================
  // Google Models
  // ============================================================
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    model: 'gemini-2.5-pro',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    model: 'gemini-2.5-flash',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    model: 'gemini-2.0-flash',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    model: 'gemini-1.5-pro',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
    model: 'gemini-1.5-flash',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },

  // ============================================================
  // DeepSeek Models
  // ============================================================
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'deepseek',
    model: 'deepseek-chat',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
  },

  // ============================================================
  // Mistral Models
  // ============================================================
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    provider: 'mistral',
    model: 'mistral-large-latest',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'mistral-medium',
    name: 'Mistral Medium',
    provider: 'mistral',
    model: 'mistral-medium-latest',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'mistral-small',
    name: 'Mistral Small',
    provider: 'mistral',
    model: 'mistral-small-latest',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'mixtral-8x7b',
    name: 'Mixtral 8x7B',
    provider: 'mistral',
    model: 'open-mixtral-8x7b',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'mixtral-8x22b',
    name: 'Mixtral 8x22B',
    provider: 'mistral',
    model: 'open-mixtral-8x22b',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1,
  },

  // ============================================================
  // Alibaba (Qwen) Models
  // ============================================================
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'alibaba',
    model: 'qwen-max',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'alibaba',
    model: 'qwen-plus',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'qwen-turbo',
    name: 'Qwen Turbo',
    provider: 'alibaba',
    model: 'qwen-turbo',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },

  // ============================================================
  // Moonshot (Kimi) Models — provider = moonshotai
  // ============================================================
  {
    id: 'kimi-k2-5',
    name: 'Kimi K2.5',
    provider: 'moonshotai',
    model: 'kimi-k2.5',
    maxTokens: 32768,
    temperature: 1,
    topP: 0.95,
  },

  // ============================================================
  // xAI (Grok) Models
  // ============================================================
  {
    id: 'grok-4',
    name: 'Grok 4',
    provider: 'xai',
    model: 'grok-4',
    maxTokens: 32768,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'grok-3',
    name: 'Grok 3',
    provider: 'xai',
    model: 'grok-3',
    maxTokens: 32768,
    temperature: 0.7,
    topP: 1,
  },

  // ============================================================
  // MiniMax Models
  // ============================================================
  {
    id: 'minimax-m2-5',
    name: 'MiniMax M2.5',
    provider: 'minimax',
    model: 'minimax-m2.5',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },

  // ============================================================
  // Zhipu AI (GLM) Models — provider = zhipuai
  // ============================================================
  {
    id: 'glm-4-5',
    name: 'GLM-4.5',
    provider: 'zhipuai',
    model: 'glm-4.5',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1,
  },
];

export const MODEL_CATEGORIES: Record<string, { name: string; color: string }> = {
  openai: { name: 'OpenAI', color: '#10a37f' },
  anthropic: { name: 'Anthropic', color: '#d97757' },
  google: { name: 'Google', color: '#4285f4' },
  deepseek: { name: 'DeepSeek', color: '#4f46e5' },
  mistral: { name: 'Mistral AI', color: '#ff7000' },
  alibaba: { name: 'Alibaba', color: '#ff6a00' },
  moonshotai: { name: 'Kimi (Moonshot)', color: '#6366f1' },
  xai: { name: 'xAI (Grok)', color: '#1d1d1f' },
  minimax: { name: 'MiniMax', color: '#f59e0b' },
  zhipuai: { name: 'Zhipu AI', color: '#3b82f6' },
};

export const getRecommendedModels = (): AIModel[] => {
  return AVAILABLE_MODELS.filter((model) =>
    ['gpt-4o', 'claude-sonnet-4-6', 'gemini-2.5-pro', 'deepseek-chat', 'grok-4', 'qwen-max'].includes(model.id),
  );
};

export const getModelById = (id: string): AIModel | undefined => {
  return AVAILABLE_MODELS.find((model) => model.id === id);
};

export const getModelsByProvider = (provider: string): AIModel[] => {
  return AVAILABLE_MODELS.filter((model) => model.provider === provider);
};
