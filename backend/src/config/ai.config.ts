import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    models: {
      'gpt-4-turbo': {
        name: 'GPT-4 Turbo',
        model: 'gpt-4-turbo-preview',
        maxTokens: 4096,
        temperature: 0.7,
      },
      'gpt-3.5-turbo': {
        name: 'GPT-3.5 Turbo',
        model: 'gpt-3.5-turbo',
        maxTokens: 4096,
        temperature: 0.7,
      },
    },
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    models: {
      'claude-sonnet-4-6': {
        name: 'Claude Sonnet 4.6',
        model: 'claude-sonnet-4-6',
        maxTokens: 64000,
        temperature: 0.7,
      },
      'claude-opus-4-6': {
        name: 'Claude Opus 4.6',
        model: 'claude-opus-4-6',
        maxTokens: 128000,
        temperature: 0.7,
      },
      'claude-haiku-4-5': {
        name: 'Claude Haiku 4.5',
        model: 'claude-haiku-4-5',
        maxTokens: 64000,
        temperature: 0.7,
      },
    },
  },
  google: {
    apiKey: process.env.GOOGLE_AI_API_KEY,
    models: {
      'gemini-pro': {
        name: 'Gemini Pro',
        model: 'gemini-pro',
        maxTokens: 4096,
        temperature: 0.7,
      },
    },
  },
  moonshot: {
    apiKey: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY,
    models: {
      'kimi-k2-5': {
        name: 'Kimi K2.5',
        model: 'kimi-k2.5',
        maxTokens: 32768,
        temperature: 1,
      },
    },
  },
}));
