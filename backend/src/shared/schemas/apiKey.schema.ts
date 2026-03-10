import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { EncryptionUtil } from '../utils/encryption.util';

export type ApiKeyDocument = ApiKey & Document;

@Schema({ timestamps: true })
export class ApiKey {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  provider: string;

  // 加密的API Key (存储格式: iv:authTag:encryptedData)
  @Prop({ required: true })
  keyEncrypted: string;

  @Prop()
  description?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastUsedAt?: Date;

  @Prop({ default: 0 })
  useCount: number;

  @Prop()
  expiresAt?: Date;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: false })
  isDeprecated: boolean;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;

  // 虚拟字段 - 解密后的key（仅在内存中使用，不存储）
  get key(): string {
    try {
      return EncryptionUtil.decrypt(this.keyEncrypted);
    } catch (error) {
      console.error('Failed to decrypt API key:', error.message);
      return '';
    }
  }
}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);

// 静态方法：创建时自动加密
ApiKeySchema.statics.createEncrypted = function(data: Partial<ApiKey>) {
  if (data.keyEncrypted) {
    // 如果已经提供了加密key，直接使用
    return this.create(data);
  }
  
  // 从临时字段获取明文key并加密
  const plainKey = (data as any)._plainKey;
  if (!plainKey) {
    throw new Error('API key is required');
  }
  
  const encrypted = EncryptionUtil.encrypt(plainKey);
  return this.create({
    ...data,
    keyEncrypted: encrypted
  });
};

// 实例方法：解密获取明文key
ApiKeySchema.methods.getDecryptedKey = function(): string {
  try {
    return EncryptionUtil.decrypt(this.keyEncrypted);
  } catch (error) {
    console.error('Failed to decrypt API key:', error.message);
    return '';
  }
};

// 索引
ApiKeySchema.index({ provider: 1 });
ApiKeySchema.index({ isActive: 1 });
ApiKeySchema.index({ id: 1 });
ApiKeySchema.index({ provider: 1, isDefault: 1 });
