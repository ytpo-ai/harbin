import { generateText, streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { fetch as undiciFetch } from 'undici';
import { AIModel, ChatMessage, ContentPart, extractTextContent } from '@libs/contracts';
import { getProxyDispatcher } from '@libs/infra';
import { BaseAIProvider, LLMCallOptions, ProviderChatResult } from './v1/base-provider';

const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';
const DEFAULT_ALIBABA_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const IMAGE_FETCH_MAX_BYTES = 20 * 1024 * 1024; // 20 MB guard

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
        const resolvedBaseURL = String(
          process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || process.env.AI_API_ENDPOINT || '',
        ).trim() || undefined;
        const openai = createOpenAI({
          apiKey: apiKey || process.env.OPENAI_API_KEY,
          ...(resolvedBaseURL ? { baseURL: resolvedBaseURL } : {}),
          ...(fetcher ? { fetch: fetcher } : {}),
        } as any);
        this.openAICompatibleClient = openai;
        // When behind a custom gateway/proxy, use Chat Completions API (.chat()) directly
        // to avoid 404 from Responses API which proxies may not support.
        // When hitting OpenAI directly (no baseURL override), use the default which
        // routes to Responses API for supported models.
        this.languageModel = resolvedBaseURL ? openai.chat(this.model.model as any) : openai(this.model.model);
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
      case 'moonshotai':
      case 'moonshot':
      case 'kimi': {
        const moonshot = createOpenAI({
          apiKey: apiKey || process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY,
          baseURL: process.env.MOONSHOT_BASE_URL || DEFAULT_MOONSHOT_BASE_URL,
          ...(fetcher ? { fetch: fetcher } : {}),
        } as any);
        this.openAICompatibleClient = moonshot;
        // Moonshot is OpenAI-compatible but only supports Chat Completions API,
        // not Responses API. Always use .chat() to avoid 404.
        this.languageModel = moonshot.chat(this.model.model as any);
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
      case 'deepseek': {
        const deepseekApiKey = apiKey || process.env.DEEPSEEK_API_KEY;
        if (!deepseekApiKey) {
          throw new Error('DeepSeek API key is missing. Pass it using the apiKey parameter or the DEEPSEEK_API_KEY environment variable.');
        }
        const deepseek = createOpenAI({
          apiKey: deepseekApiKey,
          baseURL: process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
          compatibility: 'compatible',
          ...(fetcher ? { fetch: fetcher } : {}),
        } as any);
        this.openAICompatibleClient = deepseek;
        this.languageModel = deepseek.chat(this.model.model as any);
        break;
      }
      default:
        throw new Error(`AIV2Provider does not support provider: ${model.provider}`);
    }
  }

  // ---- Multimodal image helpers ----

  private static inferMimeType(url: string): string {
    const pathname = (() => {
      try {
        return new URL(url).pathname.toLowerCase();
      } catch {
        return String(url || '').toLowerCase();
      }
    })();
    if (pathname.endsWith('.png')) return 'image/png';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.gif')) return 'image/gif';
    if (pathname.endsWith('.bmp')) return 'image/bmp';
    if (pathname.endsWith('.svg')) return 'image/svg+xml';
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    return 'image/jpeg';
  }

  private static isRemoteUrl(url: string): boolean {
    const lower = String(url || '').trim().toLowerCase();
    return lower.startsWith('http://') || lower.startsWith('https://');
  }

  private async fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
    const dispatcher = getProxyDispatcher();
    const response = await undiciFetch(url, {
      ...(dispatcher ? { dispatcher } : {}),
    } as any);

    if (!response.ok) {
      throw new Error(`failed to fetch image url=${url} status=${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > IMAGE_FETCH_MAX_BYTES) {
      throw new Error(`image too large: url=${url} size=${contentLength} limit=${IMAGE_FETCH_MAX_BYTES}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > IMAGE_FETCH_MAX_BYTES) {
      throw new Error(`image too large: url=${url} size=${arrayBuffer.byteLength} limit=${IMAGE_FETCH_MAX_BYTES}`);
    }

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim();
    const mimeType = contentType || AIV2Provider.inferMimeType(url);
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return { base64, mimeType };
  }

  /**
   * Pre-process messages: download remote image URLs and convert to inline base64 data URLs.
   * This is necessary because many OpenAI-compatible gateways (and OpenAI itself for non-allowlisted
   * domains like Chinese cloud OSS) reject remote image URLs.
   * Downloads happen in parallel per message for efficiency.
   */
  private async inlineRemoteImages(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const result: ChatMessage[] = [];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push(msg);
        continue;
      }

      // Collect download tasks for this message
      const partPromises = msg.content.map(async (part): Promise<ContentPart> => {
        if (part.type !== 'image_url') return part;

        const url = String(part.imageUrl?.url || '').trim();
        if (!url || !AIV2Provider.isRemoteUrl(url)) return part;

        const { base64, mimeType } = await this.fetchImageAsBase64(url);
        return {
          type: 'image_url',
          imageUrl: {
            url: `data:${mimeType};base64,${base64}`,
            ...(part.imageUrl.detail ? { detail: part.imageUrl.detail } : {}),
          },
        };
      });

      const convertedParts = await Promise.all(partPromises);
      result.push({ ...msg, content: convertedParts });
    }

    return result;
  }

  private hasRemoteImageUrls(messages: ChatMessage[]): boolean {
    return messages.some((msg) => {
      if (typeof msg.content === 'string') return false;
      return msg.content.some(
        (part) => part.type === 'image_url' && AIV2Provider.isRemoteUrl(part.imageUrl.url),
      );
    });
  }

  // ---- formatMessages ----

  /**
   * Override base formatMessages to support multimodal ContentPart[].
   * - string content: passthrough as-is (zero impact on existing paths)
   * - ContentPart[]: convert to Vercel AI SDK CoreMessage content format
   *
   * By the time this is called, remote image URLs have already been converted to
   * data URLs via inlineRemoteImages() in the public entry points (chatWithMeta/streamingChat).
   */
  protected formatMessages(messages: ChatMessage[]): any[] {
    return messages.map((msg) => {
      // Fast path: string content (all existing callers)
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }

      // Multimodal path: ContentPart[] → Vercel AI SDK UserContent parts
      const parts = (msg.content as ContentPart[]).map((part) => {
        if (part.type === 'text') {
          return { type: 'text' as const, text: part.text };
        }
        if (part.type === 'image_url') {
          const url = String(part.imageUrl?.url || '').trim();

          // data URL → extract base64 + mimeType and pass inline
          // (Vercel AI SDK rejects data: scheme in new URL() download path)
          const dataUrlMatch = url.match(/^data:([^;]+);base64,(.+)$/);
          if (dataUrlMatch) {
            return {
              type: 'image' as const,
              image: Buffer.from(dataUrlMatch[2], 'base64'),
              mimeType: dataUrlMatch[1],
            };
          }

          // Remote URL → pass as URL object (SDK will fetch it)
          return { type: 'image' as const, image: new URL(url) };
        }
        // Fallback: unknown part type, extract as text
        return { type: 'text' as const, text: extractTextContent([part]) };
      });

      return { role: msg.role, content: parts };
    });
  }

  // ---- Model / options helpers ----

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

  private buildCallOptions(options?: LLMCallOptions): {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    responseFormat?: { type: 'json_object' | 'text' };
    providerOptions?: Record<string, any>;
  } {
    const tokenLimit = Number(options?.maxTokens || this.model.maxTokens);
    const maxOutputTokens = Number.isFinite(tokenLimit) && tokenLimit > 0 ? tokenLimit : undefined;
    const isReasoning = this.isOpenAIReasoningModel();
    const providerOptions = this.getReasoningProviderOptions();
    const mergedProviderOptions = providerOptions ? { ...providerOptions } : undefined;
    let responseFormat: { type: 'json_object' | 'text' } | undefined;
    if (options?.responseFormat?.type === 'json_object') {
      if (
        this.providerName === 'openai'
        || this.providerName === 'moonshotai'
        || this.providerName === 'moonshot'
        || this.providerName === 'kimi'
        || this.providerName === 'alibaba'
        || this.providerName === 'qwen'
        || this.providerName === 'deepseek'
      ) {
        responseFormat = { type: 'json_object' };
      }
      if (this.providerName === 'google') {
        const googleOptions = ((mergedProviderOptions || {}).google || {}) as Record<string, unknown>;
        const nextProviderOptions = {
          ...(mergedProviderOptions || {}),
          google: {
            ...googleOptions,
            responseMimeType: 'application/json',
          },
        };
        return {
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
          ...(!isReasoning
            ? {
                temperature: options?.temperature ?? this.model.temperature ?? 0.7,
                topP: options?.topP ?? this.model.topP ?? 1,
              }
            : {}),
          providerOptions: nextProviderOptions,
        };
      }
    }

    return {
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(!isReasoning
        ? {
            temperature: options?.temperature ?? this.model.temperature ?? 0.7,
            topP: options?.topP ?? this.model.topP ?? 1,
          }
        : {}),
      ...(responseFormat ? { responseFormat } : {}),
      ...(mergedProviderOptions ? { providerOptions: mergedProviderOptions } : {}),
    };
  }

  // ---- Error classification ----

  private isNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const lower = message.toLowerCase();
    return lower.includes('not found') || lower.includes('404');
  }

  private isAuthenticationError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const lower = message.toLowerCase();
    return lower.includes('invalid authentication') || lower.includes('unauthorized') || lower.includes('401');
  }

  // ---- Alibaba fallback ----

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

  // ---- Usage normalization ----

  private normalizeUsage(usage: any): ProviderChatResult['usage'] {
    if (!usage || typeof usage !== 'object') {
      return undefined;
    }
    const promptTokens = Number(usage.promptTokens ?? usage.inputTokens ?? 0);
    const completionTokens = Number(usage.completionTokens ?? usage.outputTokens ?? 0);
    const totalTokens = Number(usage.totalTokens ?? promptTokens + completionTokens);
    const reasoningTokens = Number(usage.reasoningTokens ?? usage.reasoning_tokens ?? 0) || undefined;
    const cachedInputTokens = Number(usage.cachedInputTokens ?? usage.cached_tokens ?? 0) || undefined;
    const cacheWriteTokens = Number(usage.cacheWriteTokens ?? usage.cache_write_tokens ?? 0) || undefined;
    return {
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
      reasoningTokens,
      cachedInputTokens,
      cacheWriteTokens,
    };
  }

  // ---- Public API ----

  async chatWithMeta(messages: ChatMessage[], options?: LLMCallOptions): Promise<ProviderChatResult> {
    // Pre-process: inline remote image URLs before any API call
    const prepared = this.hasRemoteImageUrls(messages)
      ? await this.inlineRemoteImages(messages)
      : messages;

    try {
      const result = await generateText({
        model: this.languageModel,
        messages: this.formatMessages(prepared) as any,
        ...this.buildCallOptions(options),
      });
      return {
        response: result.text || '',
        usage: this.normalizeUsage((result as any).usage),
        finishReason: (result as any).finishReason,
      };
    } catch (error) {
      if (this.isAuthenticationError(error)) {
        const message = error instanceof Error ? error.message : String(error || 'Invalid Authentication');
        throw new Error(
          `${message} (provider=${this.providerName}; model=${this.model.model}). `
            + '请确认：1) Agent 绑定的 apiKeyId 对应 provider 正确；2) 系统环境变量 key 有效；3) 如走代理网关请设置 OPENAI_BASE_URL/OPENAI_API_BASE。',
        );
      }

      const fallbackModel = this.getAlibabaFallbackModelName();
      if (fallbackModel && this.isNotFoundError(error) && this.openAICompatibleClient) {
        const result = await generateText({
          model: this.openAICompatibleClient.chat(fallbackModel as any),
          messages: this.formatMessages(prepared) as any,
          ...this.buildCallOptions(options),
        });
        return {
          response: result.text || '',
          usage: this.normalizeUsage((result as any).usage),
          finishReason: (result as any).finishReason,
        };
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

  async chat(messages: ChatMessage[], options?: LLMCallOptions): Promise<string> {
    const result = await this.chatWithMeta(messages, options);
    return result.response;
  }

  async streamingChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: LLMCallOptions,
  ): Promise<void> {
    // Pre-process: inline remote image URLs before any API call
    const prepared = this.hasRemoteImageUrls(messages)
      ? await this.inlineRemoteImages(messages)
      : messages;

    const runStream = async (model: any): Promise<void> => {
      const result = streamText({
        model,
        messages: this.formatMessages(prepared) as any,
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
      if (this.isAuthenticationError(error)) {
        const message = error instanceof Error ? error.message : String(error || 'Invalid Authentication');
        throw new Error(
          `${message} (provider=${this.providerName}; model=${this.model.model}). `
            + '请确认：1) Agent 绑定的 apiKeyId 对应 provider 正确；2) 系统环境变量 key 有效；3) 如走代理网关请设置 OPENAI_BASE_URL/OPENAI_API_BASE。',
        );
      }

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
