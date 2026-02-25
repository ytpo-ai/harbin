import { AIModel } from '../shared/types';

export const AVAILABLE_MODELS: AIModel[] = [
  // OpenAI Models
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    model: 'gpt-4-turbo-preview',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    model: 'gpt-4',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    model: 'gpt-3.5-turbo',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'o1-preview',
    name: 'o1 Preview',
    provider: 'openai',
    model: 'o1-preview',
    maxTokens: 32768,
    temperature: 1,
    topP: 1
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini',
    provider: 'openai',
    model: 'o1-mini',
    maxTokens: 65536,
    temperature: 1,
    topP: 1
  },

  // Anthropic Models
  {
    id: 'claude-3-opus',
    name: 'Claude 3 Opus',
    provider: 'anthropic',
    model: 'claude-3-opus-20240229',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'claude-3-sonnet',
    name: 'Claude 3 Sonnet',
    provider: 'anthropic',
    model: 'claude-3-sonnet-20240229',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },

  // Google Models
  {
    id: 'gemini-pro',
    name: 'Gemini Pro',
    provider: 'google',
    model: 'gemini-pro',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    model: 'gemini-1.5-pro',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
    model: 'gemini-1.5-flash',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'gemini-ultra',
    name: 'Gemini Ultra',
    provider: 'google',
    model: 'gemini-ultra',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },

  // DeepSeek Models
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'deepseek',
    model: 'deepseek-chat',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'deepseek-coder',
    name: 'DeepSeek Coder',
    provider: 'deepseek',
    model: 'deepseek-coder',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },

  // Mistral Models
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    provider: 'mistral',
    model: 'mistral-large-latest',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'mistral-medium',
    name: 'Mistral Medium',
    provider: 'mistral',
    model: 'mistral-medium-latest',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'mistral-small',
    name: 'Mistral Small',
    provider: 'mistral',
    model: 'mistral-small-latest',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'mixtral-8x7b',
    name: 'Mixtral 8x7B',
    provider: 'mistral',
    model: 'open-mixtral-8x7b',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'mixtral-8x22b',
    name: 'Mixtral 8x22B',
    provider: 'mistral',
    model: 'open-mixtral-8x22b',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },

  // Meta Models
  {
    id: 'llama-2-70b',
    name: 'Llama 2 70B',
    provider: 'meta',
    model: 'llama-2-70b-chat',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'llama-3-8b',
    name: 'Llama 3 8B',
    provider: 'meta',
    model: 'llama-3-8b-instruct',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'llama-3-70b',
    name: 'Llama 3 70B',
    provider: 'meta',
    model: 'llama-3-70b-instruct',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    provider: 'meta',
    model: 'llama-3.1-8b-instruct',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'llama-3.1-70b',
    name: 'Llama 3.1 70B',
    provider: 'meta',
    model: 'llama-3.1-70b-instruct',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'llama-3.1-405b',
    name: 'Llama 3.1 405B',
    provider: 'meta',
    model: 'llama-3.1-405b-instruct',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },

  // Alibaba Models
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'alibaba',
    model: 'qwen-max',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'alibaba',
    model: 'qwen-plus',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'qwen-turbo',
    name: 'Qwen Turbo',
    provider: 'alibaba',
    model: 'qwen-turbo',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'qwen2-72b',
    name: 'Qwen2 72B',
    provider: 'alibaba',
    model: 'qwen2-72b-instruct',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'qwen-coder',
    name: 'Qwen Coder',
    provider: 'alibaba',
    model: 'qwen-coder',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },

  // Moonshot Models
  {
    id: 'moonshot-v1-8k',
    name: 'Moonshot v1 8K',
    provider: 'moonshot',
    model: 'moonshot-v1-8k',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'moonshot-v1-32k',
    name: 'Moonshot v1 32K',
    provider: 'moonshot',
    model: 'moonshot-v1-32k',
    maxTokens: 32768,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'moonshot-v1-128k',
    name: 'Moonshot v1 128K',
    provider: 'moonshot',
    model: 'moonshot-v1-128k',
    maxTokens: 128000,
    temperature: 0.7,
    topP: 1
  },

  // Baichuan Models
  {
    id: 'baichuan4',
    name: 'Baichuan 4',
    provider: 'baichuan',
    model: 'Baichuan4',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'baichuan3-turbo',
    name: 'Baichuan 3 Turbo',
    provider: 'baichuan',
    model: 'Baichuan3-Turbo',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'baichuan2-turbo',
    name: 'Baichuan 2 Turbo',
    provider: 'baichuan',
    model: 'Baichuan2-Turbo',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  },

  // Zhipu Models
  {
    id: 'glm-4',
    name: 'GLM-4',
    provider: 'zhipu',
    model: 'glm-4',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'glm-4-plus',
    name: 'GLM-4 Plus',
    provider: 'zhipu',
    model: 'glm-4-plus',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'glm-4-air',
    name: 'GLM-4 Air',
    provider: 'zhipu',
    model: 'glm-4-air',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },

  // Xunfei Models
  {
    id: 'spark-v4',
    name: 'Spark v4',
    provider: 'xunfei',
    model: 'spark-v4',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'spark-v3.5',
    name: 'Spark v3.5',
    provider: 'xunfei',
    model: 'spark-v3.5',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },

  // MiniMax Models
  {
    id: 'abab6.5s',
    name: 'abab 6.5s',
    provider: 'minimax',
    model: 'abab6.5s-chat',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'abab6.5',
    name: 'abab 6.5',
    provider: 'minimax',
    model: 'abab6.5-chat',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },

  // Moonshot (Kimi) Models
  {
    id: 'kimi-latest',
    name: 'Kimi Latest',
    provider: 'moonshot',
    model: 'kimi-latest',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'kimi-k1',
    name: 'Kimi K1',
    provider: 'moonshot',
    model: 'kimi-k1',
    maxTokens: 8192,
    temperature: 0.7,
    topP: 1
  },

  // Microsoft Models
  {
    id: 'phi-3-mini',
    name: 'Phi-3 Mini',
    provider: 'microsoft',
    model: 'phi-3-mini-128k-instruct',
    maxTokens: 128000,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'phi-3-medium',
    name: 'Phi-3 Medium',
    provider: 'microsoft',
    model: 'phi-3-medium-128k-instruct',
    maxTokens: 128000,
    temperature: 0.7,
    topP: 1
  },
  {
    id: 'phi-3-small',
    name: 'Phi-3 Small',
    provider: 'microsoft',
    model: 'phi-3-small-128k-instruct',
    maxTokens: 128000,
    temperature: 0.7,
    topP: 1
  }
];

export const MODEL_CATEGORIES = {
  'openai': { name: 'OpenAI', color: '#10a37f' },
  'anthropic': { name: 'Anthropic', color: '#d97757' },
  'google': { name: 'Google', color: '#4285f4' },
  'deepseek': { name: 'DeepSeek', color: '#4f46e5' },
  'mistral': { name: 'Mistral AI', color: '#ff7000' },
  'meta': { name: 'Meta AI', color: '#0668e1' },
  'alibaba': { name: 'Alibaba', color: '#ff6a00' },
  'moonshot': { name: 'Kimi (Moonshot)', color: '#000000' },
  'baichuan': { name: 'Baichuan', color: '#1a73e8' },
  'zhipu': { name: 'Zhipu AI', color: '#3b82f6' },
  'xunfei': { name: 'Xunfei', color: '#0ea5e9' },
  'minimax': { name: 'MiniMax', color: '#f59e0b' },
  'microsoft': { name: 'Microsoft', color: '#00a4ef' }
};

export const getRecommendedModels = (): AIModel[] => {
  return AVAILABLE_MODELS.filter(model => [
    'gpt-4-turbo',
    'claude-3-opus',
    'gemini-1.5-pro',
    'qwen-max',
    'kimi-latest',
    'deepseek-chat'
  ].includes(model.id));
};

export const getModelById = (id: string): AIModel | undefined => {
  return AVAILABLE_MODELS.find(model => model.id === id);
};

export const getModelsByProvider = (provider: string): AIModel[] => {
  return AVAILABLE_MODELS.filter(model => model.provider === provider);
};