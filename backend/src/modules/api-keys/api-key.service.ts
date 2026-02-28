import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiKey, ApiKeyDocument } from '../../shared/schemas/apiKey.schema';
import { EncryptionUtil } from '../../shared/utils/encryption.util';
import { v4 as uuidv4 } from 'uuid';

export interface CreateApiKeyDto {
  name: string;
  provider: string;
  key: string; // 明文key，会被自动加密
  description?: string;
  isActive?: boolean;
  expiresAt?: Date;
}

export interface UpdateApiKeyDto {
  name?: string;
  provider?: string;
  key?: string; // 明文key，如果提供会重新加密
  description?: string;
  isActive?: boolean;
  expiresAt?: Date;
}

export interface ApiKeyResponse {
  _id: string;
  id: string;
  name: string;
  provider: string;
  keyMasked: string; // 脱敏显示的key
  description?: string;
  isActive: boolean;
  lastUsedAt?: Date;
  useCount: number;
  expiresAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKeyDocument>
  ) {}

  /**
   * 创建新的API Key（自动加密）
   */
  async createApiKey(apiKeyData: CreateApiKeyDto): Promise<ApiKeyResponse> {
    const normalizedProvider = (apiKeyData.provider || '').trim().toLowerCase();
    const normalizedKey = (apiKeyData.key || '').trim();

    // 检查是否已存在相同提供商和名称的key
    const existingKey = await this.apiKeyModel.findOne({ 
      name: apiKeyData.name,
      provider: normalizedProvider,
    }).exec();
    
    if (existingKey) {
      throw new ConflictException(`API Key with name "${apiKeyData.name}" already exists for provider ${apiKeyData.provider}`);
    }

    // 加密API Key
    const encryptedKey = EncryptionUtil.encrypt(normalizedKey);

    const newApiKey = new this.apiKeyModel({
      id: uuidv4(),
      name: apiKeyData.name,
      provider: normalizedProvider,
      keyEncrypted: encryptedKey,
      description: apiKeyData.description,
      isActive: apiKeyData.isActive ?? true,
      expiresAt: apiKeyData.expiresAt,
      useCount: 0,
    });

    const saved = await newApiKey.save();
    this.logger.log(`Created encrypted API Key: ${saved.name} for ${saved.provider}`);
    
    return this.toResponse(saved);
  }

  /**
   * 获取所有API Keys（返回脱敏版本）
   */
  async getAllApiKeys(): Promise<ApiKeyResponse[]> {
    const keys = await this.apiKeyModel.find().sort({ provider: 1, name: 1 }).exec();
    return keys.map(key => this.toResponse(key));
  }

  /**
   * 获取单个API Key（返回脱敏版本）
   */
  async getApiKey(id: string): Promise<ApiKeyResponse | null> {
    const key = await this.apiKeyModel.findOne({ id }).exec();
    return key ? this.toResponse(key) : null;
  }

  /**
   * 按提供商获取API Keys
   */
  async getApiKeysByProvider(provider: string): Promise<ApiKeyResponse[]> {
    const keys = await this.apiKeyModel.find({ provider }).exec();
    return keys.map(key => this.toResponse(key));
  }

  /**
   * 更新API Key
   */
  async updateApiKey(id: string, updates: UpdateApiKeyDto): Promise<ApiKeyResponse | null> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date()
    };

    if (typeof updates.provider === 'string') {
      updateData.provider = updates.provider.trim().toLowerCase();
    }

    // 如果提供了新的key，需要重新加密
    if (updates.key) {
      updateData.keyEncrypted = EncryptionUtil.encrypt(updates.key.trim());
      delete updateData.key; // 删除明文key字段
    }

    const updated = await this.apiKeyModel.findOneAndUpdate(
      { id },
      updateData,
      { new: true }
    ).exec();

    if (updated) {
      this.logger.log(`Updated API Key: ${id}`);
    }

    return updated ? this.toResponse(updated) : null;
  }

  /**
   * 删除API Key
   */
  async deleteApiKey(id: string): Promise<boolean> {
    const result = await this.apiKeyModel.findOneAndDelete({ id }).exec();
    if (result) {
      this.logger.log(`Deleted API Key: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * 记录API Key使用
   */
  async recordUsage(id: string): Promise<void> {
    await this.apiKeyModel.findOneAndUpdate(
      { id },
      { 
        $inc: { useCount: 1 },
        lastUsedAt: new Date()
      }
    ).exec();
  }

  /**
   * 获取解密后的API Key（用于实际调用AI服务）
   */
  async getDecryptedKey(id: string): Promise<string | null> {
    const apiKey = await this.apiKeyModel.findOne({ id }).exec();
    if (!apiKey) {
      return null;
    }

    try {
      return EncryptionUtil.decrypt(apiKey.keyEncrypted).trim();
    } catch (error) {
      this.logger.error(`Failed to decrypt API key ${id}: ${error.message}`);
      return null;
    }
  }

  /**
   * 获取API Key统计信息
   */
  async getApiKeyStats(): Promise<any> {
    const total = await this.apiKeyModel.countDocuments();
    const active = await this.apiKeyModel.countDocuments({ isActive: true });
    
    const byProvider = await this.apiKeyModel.aggregate([
      {
        $group: {
          _id: '$provider',
          count: { $sum: 1 },
          activeCount: {
            $sum: { $cond: ['$isActive', 1, 0] }
          }
        }
      }
    ]).exec();

    return {
      total,
      active,
      inactive: total - active,
      byProvider
    };
  }

  /**
   * 转换为响应格式（脱敏处理）
   */
  private toResponse(apiKey: ApiKeyDocument): ApiKeyResponse {
    return {
      _id: apiKey._id.toString(),
      id: apiKey.id,
      name: apiKey.name,
      provider: apiKey.provider,
      keyMasked: this.maskKey(apiKey.keyEncrypted), // 脱敏显示
      description: apiKey.description,
      isActive: apiKey.isActive,
      lastUsedAt: apiKey.lastUsedAt,
      useCount: apiKey.useCount,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
    };
  }

  /**
   * 脱敏显示API Key
   * 由于加密后无法获取原始key的部分信息，我们显示加密数据的哈希前缀
   */
  private maskKey(encryptedKey: string): string {
    // 显示加密字符串的前8个字符和最后4个字符
    if (encryptedKey.length <= 12) {
      return encryptedKey;
    }
    return `${encryptedKey.substring(0, 8)}****${encryptedKey.slice(-4)}`;
  }
}
