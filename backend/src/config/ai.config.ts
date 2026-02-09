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
      'claude-3-sonnet': {
        name: 'Claude 3 Sonnet',
        model: 'claude-3-sonnet-20240229',
        maxTokens: 4096,
        temperature: 0.7,
      },
      'claude-3-haiku': {
        name: 'Claude 3 Haiku',
        model: 'claude-3-haiku-20240307',
        maxTokens: 4096,
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
}));