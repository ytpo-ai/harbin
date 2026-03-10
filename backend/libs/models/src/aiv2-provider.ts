import { generateText, streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { fetch as undiciFetch } from 'undici';
import { AIModel, ChatMessage } from '@libs/contracts';
import { getProxyDispatcher } from '@libs/infra';
import { BaseAIProvider } from './v1/base-provider';

const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';
const DEFAULT_ALIBABA_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export class AIV2Provider extends BaseAIProvider {
  private languageModel: any;
  private providerName: string;
  private openAICompatibleClient?: ReturnType<typeof createOpenAI>;
  private alibabaBaseURL?: string;

  constructor(model: AIModel, apiKey?: string) {
    super(model, apiKey);

    const provider = String(model.provider || '').toLowerCase().trim();
    this.providerName = provider;
    const dispatcher = getProxyDispatcher();
    const fetcher = dispatcher
      ? ((url: any, init: any) =>
          undiciFetch(url, {
            ...init,
            dispatcher,
          }))
      : undefined;

    switch (provider) {
      case 'openai': {
        const openai = createOpenAI({
          apiKey: apiKey || process.env.OPENAI_API_KEY,
          ...(fetcher ? { fetch: fetcher } : {}),
        } as any);
        this.openAICompatibleClient = openai;
        this.languageModel = openai(this.model.model);
        break;
      }
      case 'anthropic': {
        const anthropic = createAnthropic({
          apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
          ...(fetcher ? { fetch: fetcher } : {}),
        } as any);
        this.languageModel = anthropic(this.model.model);
        break;
      }
      case 'google': {
        const google = createGoogleGenerativeAI({
          apiKey: apiKey || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
          ...(fetcher ? { fetch: fetcher } : {}),
        } as any);
        this.languageModel = google(this.model.model);
        break;
      }
      case 'moonshot':
      case 'kimi': {
        const moonshot = createOpenAI({
          apiKey: apiKey || process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY,
          baseURL: process.env.MOONSHOT_BASE_URL || DEFAULT_MOONSHOT_BASE_URL,
          ...(fetcher ? { fetch: fetcher } : {}),
        } as any);
        this.openAICompatibleClient = moonshot;
        this.languageModel = moonshot(this.model.model);
        break;
      }
      case 'alibaba':
      case 'qwen': {
        const baseURL = process.env.ALIBABA_BASE_URL || process.env.DASHSCOPE_BASE_URL || DEFAULT_ALIBABA_BASE_URL;
        const alibaba = createOpenAI({
          apiKey: apiKey || process.env.ALIBABA_API_KEY || process.env.DASHSCOPE_API_KEY,
          baseURL,
          compatibility: 'compatible',
          ...(fetcher ? { fetch: fetcher } : {}),
        } as any);
        this.openAICompatibleClient = alibaba;
        this.alibabaBaseURL = baseURL;
        this.languageModel = alibaba.chat(this.model.model as any);
        break;
      }
      default:
        throw new Error(`AIV2Provider does not support provider: ${model.provider}`);
    }
  }

  private isOpenAIReasoningModel(): boolean {
    const provider = String(this.model.provider || '').toLowerCase().trim();
    if (provider !== 'openai') {
      return false;
    }

    const modelName = String(this.model.model || '').toLowerCase().trim();
    if (this.model.reasoning?.enabled) {
      return true;
    }

    return modelName.startsWith('gpt-5') || modelName.startsWith('o1') || modelName.startsWith('o3') || modelName.startsWith('o4');
  }

  private getReasoningProviderOptions(): Record<string, any> | undefined {
    if (!this.isOpenAIReasoningModel()) {
      return undefined;
    }

    const effort = this.model.reasoning?.effort;
    const verbosity = this.model.reasoning?.verbosity;

    return {
      openai: {
        ...(effort ? { reasoningEffort: effort } : {}),
        ...(verbosity ? { textVerbosity: verbosity } : {}),
      },
    };
  }

  private buildCallOptions(options?: any): {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    providerOptions?: Record<string, any>;
  } {
    const tokenLimit = Number(options?.maxTokens || this.model.maxTokens);
    const maxOutputTokens = Number.isFinite(tokenLimit) && tokenLimit > 0 ? tokenLimit : undefined;
    const isReasoning = this.isOpenAIReasoningModel();
    const providerOptions = this.getReasoningProviderOptions();

    return {
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(!isReasoning
        ? {
            temperature: options?.temperature ?? this.model.temperature ?? 0.7,
            topP: options?.topP ?? this.model.topP ?? 1,
          }
        : {}),
      ...(providerOptions ? { providerOptions } : {}),
    };
  }

  private isNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const lower = message.toLowerCase();
    return lower.includes('not found') || lower.includes('404');
  }

  private getAlibabaFallbackModelName(): string | undefined {
    if (this.providerName !== 'alibaba' && this.providerName !== 'qwen') {
      return undefined;
    }

    const modelName = String(this.model.model || '').toLowerCase().trim();
    const fallbackMap: Record<string, string> = {
      'qwen-max': 'qwen-max-latest',
      'qwen-plus': 'qwen-plus-latest',
      'qwen-turbo': 'qwen-turbo-latest',
      'qwen-coder': 'qwen-coder-plus',
    };

    return fallbackMap[modelName];
  }

  private async generateWithFallback(messages: ChatMessage[], options?: any): Promise<string> {
    const { text } = await generateText({
      model: this.languageModel,
      messages: this.formatMessages(messages) as any,
      ...this.buildCallOptions(options),
    });

    return text || '';
  }

  async chat(messages: ChatMessage[], options?: any): Promise<string> {
    try {
      return await this.generateWithFallback(messages, options);
    } catch (error) {
      const fallbackModel = this.getAlibabaFallbackModelName();
      if (fallbackModel && this.isNotFoundError(error) && this.openAICompatibleClient) {
        const { text } = await generateText({
          model: this.openAICompatibleClient.chat(fallbackModel as any),
          messages: this.formatMessages(messages) as any,
          ...this.buildCallOptions(options),
        });
        return text || '';
      }

      if ((this.providerName === 'alibaba' || this.providerName === 'qwen') && this.isNotFoundError(error)) {
        const message = error instanceof Error ? error.message : String(error || 'Not Found');
        const endpoint = this.alibabaBaseURL || DEFAULT_ALIBABA_BASE_URL;
        throw new Error(
          `${message} (alibaba endpoint=${endpoint}; model=${this.model.model}). ` +
            '请确认：1) Key 与地域匹配；2) endpoint 使用 /compatible-mode/v1；3) 模型名可用（可尝试 qwen-max-latest）。',
        );
      }

      throw error;
    }
  }

  async streamingChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: any,
  ): Promise<void> {
    const runStream = async (model: any): Promise<void> => {
      const result = streamText({
        model,
        messages: this.formatMessages(messages) as any,
        ...this.buildCallOptions(options),
      });

      for await (const token of result.textStream) {
        if (token) {
          onToken(token);
        }
      }
    };

    try {
      await runStream(this.languageModel);
    } catch (error) {
      const fallbackModel = this.getAlibabaFallbackModelName();
      if (fallbackModel && this.isNotFoundError(error) && this.openAICompatibleClient) {
        await runStream(this.openAICompatibleClient.chat(fallbackModel as any));
        return;
      }

      if ((this.providerName === 'alibaba' || this.providerName === 'qwen') && this.isNotFoundError(error)) {
        const message = error instanceof Error ? error.message : String(error || 'Not Found');
        const endpoint = this.alibabaBaseURL || DEFAULT_ALIBABA_BASE_URL;
        throw new Error(
          `${message} (alibaba endpoint=${endpoint}; model=${this.model.model}). ` +
            '请确认：1) Key 与地域匹配；2) endpoint 使用 /compatible-mode/v1；3) 模型名可用（可尝试 qwen-max-latest）。',
        );
      }

      throw error;
    }
  }
}
