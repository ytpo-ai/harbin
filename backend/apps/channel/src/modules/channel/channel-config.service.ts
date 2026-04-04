import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChannelTarget } from '../../contracts/channel-target.types';
import { EncryptionUtil } from '../../../../../src/shared/utils/encryption.util';
import { ChannelConfig, ChannelConfigDocument } from './schemas/channel-config.schema';
import { ChannelDeliveryLog, ChannelDeliveryLogDocument } from './schemas/channel-delivery-log.schema';
import { CreateChannelConfigDto, UpdateChannelConfigDto } from './dto/channel-config.dto';
import { ChannelProviderRegistry } from './channel-provider.registry';
import { ChannelMessage } from '../../contracts/channel-message.types';

@Injectable()
export class ChannelConfigService {
  constructor(
    @InjectModel(ChannelConfig.name)
    private readonly channelConfigModel: Model<ChannelConfigDocument>,
    @InjectModel(ChannelDeliveryLog.name)
    private readonly channelDeliveryLogModel: Model<ChannelDeliveryLogDocument>,
    private readonly providerRegistry: ChannelProviderRegistry,
  ) {}

  async createConfig(dto: CreateChannelConfigDto) {
    const provider = this.providerRegistry.getProvider(dto.providerType);
    const providerConfig = this.normalizeProviderConfig(
      dto.providerType,
      dto.targetType,
      dto.providerConfig,
      undefined,
    );
    const isValid = await provider.validateConfig(providerConfig);
    if (!isValid) {
      throw new BadRequestException('invalid provider config');
    }

    const created = await this.channelConfigModel.create({
      name: String(dto.name || '').trim(),
      providerType: dto.providerType,
      targetType: dto.targetType,
      providerConfig: this.encryptProviderConfig(dto.providerType, providerConfig),
      eventFilters: this.normalizeEventFilters(dto.eventFilters),
      isActive: dto.isActive !== false,
      createdBy: String(dto.createdBy || '').trim() || undefined,
    });

    return this.toResponse(created);
  }

  async listConfigs() {
    const configs = await this.channelConfigModel.find().sort({ createdAt: -1 }).exec();
    return configs.map((item) => this.toResponse(item));
  }

  async updateConfig(id: string, dto: UpdateChannelConfigDto) {
    const current = await this.channelConfigModel.findOne({ _id: id }).exec();
    if (!current) {
      throw new NotFoundException('channel config not found');
    }

    const nextTargetType = dto.targetType || current.targetType;
    const nextProviderConfig = this.normalizeProviderConfig(
      current.providerType,
      nextTargetType,
      dto.providerConfig || {},
      current.providerConfig,
    );
    const provider = this.providerRegistry.getProvider(current.providerType);
    const isValid = await provider.validateConfig(nextProviderConfig);
    if (!isValid) {
      throw new BadRequestException('invalid provider config');
    }

    const updated = await this.channelConfigModel
      .findOneAndUpdate(
        { _id: id },
        {
          $set: {
            ...(dto.name !== undefined ? { name: String(dto.name || '').trim() } : {}),
            ...(dto.targetType !== undefined ? { targetType: dto.targetType } : {}),
            providerConfig: this.encryptProviderConfig(current.providerType, nextProviderConfig),
            ...(dto.eventFilters !== undefined ? { eventFilters: this.normalizeEventFilters(dto.eventFilters) } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('channel config not found');
    }

    return this.toResponse(updated);
  }

  async deleteConfig(id: string) {
    const deleted = await this.channelConfigModel.findOneAndDelete({ _id: id }).exec();
    if (!deleted) {
      throw new NotFoundException('channel config not found');
    }
    return { success: true };
  }

  async testPush(id: string) {
    const config = await this.channelConfigModel.findOne({ _id: id }).exec();
    if (!config) {
      throw new NotFoundException('channel config not found');
    }

    const provider = this.providerRegistry.getProvider(config.providerType);
    const target = this.resolveTarget(config);
    const message: ChannelMessage = {
      title: 'Channel 测试消息',
      content: '这是一条来自 channel 服务的测试消息。',
      contentType: 'card',
      payload: {
        status: 'completed',
        summary: '测试推送成功',
        actionUrl: 'https://open.feishu.cn/',
      },
      sourceEvent: {
        eventId: `test-${Date.now()}`,
        eventType: 'channel.config.test',
        occurredAt: new Date().toISOString(),
      },
    };

    const result = await provider.send(target, message);
    await this.createDeliveryLog({
      configId: target.configId,
      eventId: message.sourceEvent.eventId,
      eventType: message.sourceEvent.eventType,
      providerType: target.providerType,
      status: result.success ? 'success' : 'failed',
      attempt: 1,
      errorMessage: result.errorMessage,
      requestPayload: {
        title: message.title,
        contentType: message.contentType,
      },
      responsePayload: {
        success: result.success,
        statusCode: result.statusCode,
      },
      deliveredAt: result.deliveredAt,
    });

    return result;
  }

  async findActiveTargetsByEventType(eventType: string): Promise<ChannelTarget[]> {
    const eventTypeValue = String(eventType || '').trim();
    if (!eventTypeValue) {
      return [];
    }

    const configs = await this.channelConfigModel.find({ isActive: true }).exec();
    const matched = configs.filter((item) => this.matchEventFilter(item.eventFilters, eventTypeValue));

    return matched.map((item) => this.resolveTarget(item));
  }

  private matchEventFilter(filters: string[], eventType: string): boolean {
    for (const filter of filters || []) {
      const normalizedFilter = String(filter || '').trim();
      if (!normalizedFilter) {
        continue;
      }
      if (normalizedFilter === eventType) {
        return true;
      }
      if (normalizedFilter.endsWith('*')) {
        const prefix = normalizedFilter.slice(0, -1);
        if (prefix && eventType.startsWith(prefix)) {
          return true;
        }
      }
    }
    return false;
  }

  async createDeliveryLog(input: {
    configId: string;
    eventId: string;
    eventType: string;
    providerType: string;
    status: 'success' | 'failed' | 'retrying';
    attempt: number;
    errorMessage?: string;
    requestPayload?: Record<string, unknown>;
    responsePayload?: Record<string, unknown>;
    deliveredAt?: Date;
  }): Promise<void> {
    await this.channelDeliveryLogModel.create({
      configId: input.configId,
      eventId: input.eventId,
      eventType: input.eventType,
      providerType: input.providerType,
      status: input.status,
      attempt: input.attempt,
      errorMessage: String(input.errorMessage || '').trim() || undefined,
      requestPayload: input.requestPayload,
      responsePayload: input.responsePayload,
      deliveredAt: input.deliveredAt,
    });
  }

  private resolveTarget(config: ChannelConfigDocument): ChannelTarget {
    const providerConfig = this.decryptProviderConfig(config.providerConfig);
    return {
      configId: config._id.toString(),
      providerType: config.providerType,
      targetType: config.targetType,
      providerConfig,
    };
  }

  private toResponse(config: ChannelConfigDocument) {
    const providerConfig = this.decryptProviderConfig(config.providerConfig);
    const common = {
      id: config._id.toString(),
      name: config.name,
      providerType: config.providerType,
      targetType: config.targetType,
      eventFilters: config.eventFilters,
      isActive: config.isActive,
      createdBy: config.createdBy,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };

    if (config.providerType === 'feishu-app') {
      return {
        ...common,
        providerConfig: {
          appIdMasked: this.maskSensitiveText(String(providerConfig.appId || ''), 3, 3),
          hasAppSecret: Boolean(providerConfig.appSecret),
          hasEncryptKey: Boolean(providerConfig.encryptKey),
          receiveId: String(providerConfig.receiveId || ''),
          receiveIdType: String(providerConfig.receiveIdType || ''),
        },
      };
    }

    return {
      ...common,
      providerConfig: {
        webhookUrlMasked: this.maskWebhookUrl(String(providerConfig.webhookUrl || '')),
        hasWebhookSecret: Boolean(providerConfig.webhookSecret),
      },
    };
  }

  private normalizeEventFilters(value: string[] | undefined): string[] {
    const list = Array.isArray(value) ? value : [];
    return Array.from(
      new Set(
        list
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );
  }

  private normalizeProviderConfig(
    providerType: 'feishu' | 'feishu-app',
    targetType: 'group' | 'user',
    value: Record<string, unknown>,
    currentEncrypted?: Record<string, unknown>,
  ): Record<string, unknown> {
    const current = currentEncrypted
      ? this.decryptProviderConfig(currentEncrypted)
      : {};

    if (providerType === 'feishu-app') {
      const appId = String(value.appId ?? current.appId ?? '').trim();
      const appSecret = String(value.appSecret ?? current.appSecret ?? '').trim();
      const encryptKey = String(value.encryptKey ?? current.encryptKey ?? '').trim() || undefined;
      const receiveId = String(value.receiveId ?? current.receiveId ?? '').trim();
      const receiveIdTypeRaw = String(value.receiveIdType ?? current.receiveIdType ?? '').trim();
      const receiveIdType =
        receiveIdTypeRaw === 'chat_id' || receiveIdTypeRaw === 'open_id'
          ? receiveIdTypeRaw
          : targetType === 'user'
            ? 'open_id'
            : 'chat_id';

      if (!appId || !appSecret || !receiveId) {
        throw new BadRequestException('providerConfig.appId/appSecret/receiveId are required for feishu-app');
      }

      return {
        appId,
        appSecret,
        encryptKey,
        receiveId,
        receiveIdType,
      };
    }

    const webhookUrl = String(value.webhookUrl ?? current.webhookUrl ?? '').trim();
    const webhookSecret = String(value.webhookSecret ?? current.webhookSecret ?? '').trim() || undefined;
    if (!webhookUrl) {
      throw new BadRequestException('providerConfig.webhookUrl is required');
    }
    return {
      webhookUrl,
      webhookSecret,
    };
  }

  private encryptProviderConfig(providerType: string, input: Record<string, unknown>): Record<string, unknown> {
    if (providerType === 'feishu-app') {
      return {
        appIdEncrypted: EncryptionUtil.encrypt(String(input.appId || '')),
        appSecretEncrypted: EncryptionUtil.encrypt(String(input.appSecret || '')),
        encryptKeyEncrypted: input.encryptKey ? EncryptionUtil.encrypt(String(input.encryptKey || '')) : undefined,
        receiveId: String(input.receiveId || ''),
        receiveIdType: String(input.receiveIdType || 'chat_id'),
      };
    }

    return {
      webhookUrlEncrypted: EncryptionUtil.encrypt(String(input.webhookUrl || '')),
      webhookSecretEncrypted: input.webhookSecret ? EncryptionUtil.encrypt(String(input.webhookSecret || '')) : undefined,
    };
  }

  private decryptProviderConfig(input: Record<string, unknown>): Record<string, unknown> {
    const appIdEncrypted = String(input.appIdEncrypted || '').trim();
    const appSecretEncrypted = String(input.appSecretEncrypted || '').trim();
    if (appIdEncrypted && appSecretEncrypted) {
      const encryptKeyRaw = String(input.encryptKeyEncrypted || '').trim();
      return {
        appId: EncryptionUtil.decrypt(appIdEncrypted),
        appSecret: EncryptionUtil.decrypt(appSecretEncrypted),
        encryptKey: encryptKeyRaw ? EncryptionUtil.decrypt(encryptKeyRaw) : undefined,
        receiveId: String(input.receiveId || '').trim(),
        receiveIdType: String(input.receiveIdType || '').trim() || undefined,
      };
    }

    const webhookUrlEncrypted = String(input.webhookUrlEncrypted || '').trim();
    const webhookSecretEncrypted = String(input.webhookSecretEncrypted || '').trim();
    return {
      webhookUrl: webhookUrlEncrypted ? EncryptionUtil.decrypt(webhookUrlEncrypted) : '',
      webhookSecret: webhookSecretEncrypted ? EncryptionUtil.decrypt(webhookSecretEncrypted) : undefined,
    };
  }

  private maskWebhookUrl(webhookUrl: string): string {
    if (!webhookUrl) {
      return '';
    }

    try {
      const parsed = new URL(webhookUrl);
      const hookPath = parsed.pathname.split('/').filter(Boolean).pop() || '';
      const masked = hookPath.length > 6 ? `${hookPath.slice(0, 3)}***${hookPath.slice(-3)}` : '***';
      return `${parsed.origin}/open-apis/bot/v2/hook/${masked}`;
    } catch {
      return '***';
    }
  }

  private maskSensitiveText(value: string, prefixSize: number, suffixSize: number): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }
    if (normalized.length <= prefixSize + suffixSize) {
      return `${normalized.slice(0, 1)}***`;
    }
    return `${normalized.slice(0, prefixSize)}***${normalized.slice(-suffixSize)}`;
  }
}
