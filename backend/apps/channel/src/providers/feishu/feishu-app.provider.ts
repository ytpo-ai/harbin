import { Injectable, Logger } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import { ChannelProvider } from '../../contracts/channel-provider.interface';
import { ChannelTarget } from '../../contracts/channel-target.types';
import { ChannelMessage } from '../../contracts/channel-message.types';
import { DeliveryResult } from '../../contracts/delivery-result.types';
import { FeishuCardBuilder } from './feishu-card-builder';
import { FeishuAppProviderConfig } from './feishu.types';

@Injectable()
export class FeishuAppProvider implements ChannelProvider {
  readonly providerType = 'feishu-app';

  private readonly logger = new Logger(FeishuAppProvider.name);
  private readonly clientCache = new Map<string, any>();

  constructor(private readonly cardBuilder: FeishuCardBuilder) {}

  async replyText(chatId: string, text: string, replyToMessageId?: string): Promise<void> {
    const normalizedChatId = String(chatId || '').trim();
    const normalizedText = String(text || '').trim();
    if (!normalizedChatId || !normalizedText) {
      return;
    }

    const runtimeConfig = this.resolveRuntimeConfig();
    if (!runtimeConfig) {
      throw new Error('feishu runtime config not available');
    }

    const client = this.getOrCreateClient(runtimeConfig);
    const replyMessageId = String(replyToMessageId || '').trim();
    const body = {
      content: JSON.stringify({ text: normalizedText }),
      msg_type: 'text',
    };

    if (replyMessageId && client?.im?.message?.reply) {
      await client.im.message.reply({
        path: {
          message_id: replyMessageId,
        },
        data: body,
      });
      return;
    }

    await client.im.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: normalizedChatId,
        ...body,
      },
    });
  }

  async send(target: ChannelTarget, message: ChannelMessage): Promise<DeliveryResult> {
    const config = this.resolveConfig(target.providerConfig, target.targetType);
    if (!config) {
      return {
        success: false,
        providerType: this.providerType,
        errorMessage: 'invalid provider config',
        deliveredAt: new Date(),
      };
    }

    try {
      const client = this.getOrCreateClient(config);
      const card = this.cardBuilder.buildCard(message);
      const response = await client.im.message.create({
        params: {
          receive_id_type: config.receiveIdType,
        },
        data: {
          receive_id: config.receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });

      const code = Number(response?.code || 0);
      if (code === 0) {
        return {
          success: true,
          providerType: this.providerType,
          statusCode: 200,
          deliveredAt: new Date(),
        };
      }

      return {
        success: false,
        providerType: this.providerType,
        statusCode: Number(response?.statusCode || 500),
        errorMessage: String(response?.msg || `feishu_app_error_${code}`),
        deliveredAt: new Date(),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`Feishu app provider send failed: configId=${target.configId} reason=${reason}`);
      return {
        success: false,
        providerType: this.providerType,
        errorMessage: reason,
        deliveredAt: new Date(),
      };
    }
  }

  async validateConfig(config: Record<string, unknown>): Promise<boolean> {
    const resolved = this.resolveConfig(config, 'group');
    if (!resolved) {
      return false;
    }

    try {
      const client = this.getOrCreateClient(resolved);
      const response = await client.auth.v3.tenantAccessToken.internal({
        data: {
          app_id: resolved.appId,
          app_secret: resolved.appSecret,
        },
      });
      return Number(response?.code || 0) === 0;
    } catch {
      return false;
    }
  }

  private resolveConfig(
    input: Record<string, unknown>,
    targetType: 'group' | 'user',
  ): FeishuAppProviderConfig | null {
    const appId = String(input.appId || '').trim();
    const appSecret = String(input.appSecret || '').trim();
    const receiveId = String(input.receiveId || '').trim();
    const encryptKey = String(input.encryptKey || '').trim() || undefined;
    const receiveIdTypeRaw = String(input.receiveIdType || '').trim();
    const receiveIdType =
      receiveIdTypeRaw === 'chat_id' || receiveIdTypeRaw === 'open_id'
        ? receiveIdTypeRaw
        : targetType === 'user'
          ? 'open_id'
          : 'chat_id';

    if (!appId || !appSecret || !receiveId) {
      return null;
    }

    return {
      appId,
      appSecret,
      encryptKey,
      receiveId,
      receiveIdType,
    };
  }

  private getOrCreateClient(config: FeishuAppProviderConfig): any {
    const cacheKey = `${config.appId}:${config.appSecret}`;
    const cached = this.clientCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const larkAny = lark as any;
    const client = new larkAny.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: larkAny.AppType?.SelfBuild,
      domain: larkAny.Domain?.Feishu,
      disableTokenCache: false,
    });
    this.clientCache.set(cacheKey, client);
    return client;
  }

  private resolveRuntimeConfig(): FeishuAppProviderConfig | null {
    const appId = String(process.env.FEISHU_APP_ID || '').trim();
    const appSecret = String(process.env.FEISHU_APP_SECRET || '').trim();
    const encryptKey = String(process.env.FEISHU_APP_ENCRYPT_KEY || '').trim() || undefined;
    if (!appId || !appSecret) {
      return null;
    }

    return {
      appId,
      appSecret,
      encryptKey,
      receiveId: 'runtime_chat',
      receiveIdType: 'chat_id',
    };
  }
}
