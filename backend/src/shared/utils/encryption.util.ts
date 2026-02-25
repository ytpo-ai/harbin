import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * AES-256-GCM 加密工具类
 * 使用环境变量 ENCRYPTION_KEY 作为主密钥
 */
export class EncryptionUtil {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16; // 初始化向量长度
  private static readonly AUTH_TAG_LENGTH = 16; // 认证标签长度
  private static readonly KEY_LENGTH = 32; // AES-256 需要32字节密钥

  /**
   * 从环境变量获取加密密钥
   * 如果密钥长度不够，使用PBKDF2派生
   */
  private static getKey(): Buffer {
    const envKey = process.env.ENCRYPTION_KEY;
    if (!envKey) {
      throw new Error('ENCRYPTION_KEY environment variable is not set');
    }

    // 使用scrypt从环境变量密钥派生出32字节密钥
    return scryptSync(envKey, 'ai-agent-team-salt', this.KEY_LENGTH);
  }

  /**
   * 加密文本
   * @param text 要加密的明文
   * @returns 加密后的密文 (base64格式: iv:authTag:encryptedData)
   */
  static encrypt(text: string): string {
    try {
      const key = this.getKey();
      const iv = randomBytes(this.IV_LENGTH);
      const cipher = createCipheriv(this.ALGORITHM, key, iv);

      let encrypted = cipher.update(text, 'utf8', 'base64');
      encrypted += cipher.final('base64');

      const authTag = cipher.getAuthTag();

      // 格式: iv:authTag:encryptedData (base64)
      return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * 解密文本
   * @param encryptedData 加密后的密文 (base64格式: iv:authTag:encryptedData)
   * @returns 解密后的明文
   */
  static decrypt(encryptedData: string): string {
    try {
      const key = this.getKey();
      const parts = encryptedData.split(':');

      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(parts[0], 'base64');
      const authTag = Buffer.from(parts[1], 'base64');
      const encrypted = parts[2];

      if (iv.length !== this.IV_LENGTH) {
        throw new Error('Invalid IV length');
      }

      if (authTag.length !== this.AUTH_TAG_LENGTH) {
        throw new Error('Invalid auth tag length');
      }

      const decipher = createDecipheriv(this.ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * 批量加密API Keys
   * @param keys 明文API Key数组
   * @returns 加密后的API Key数组
   */
  static encryptMany(keys: string[]): string[] {
    return keys.map(key => this.encrypt(key));
  }

  /**
   * 批量解密API Keys
   * @param encryptedKeys 加密后的API Key数组
   * @returns 明文API Key数组
   */
  static decryptMany(encryptedKeys: string[]): string[] {
    return encryptedKeys.map(key => this.decrypt(key));
  }
}

export default EncryptionUtil;
