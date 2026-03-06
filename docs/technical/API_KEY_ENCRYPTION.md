# API Key 加密存储说明

## 概述

为了确保API Key的安全性，系统使用 **AES-256-GCM** 算法对所有存储的API Key进行加密。

## 加密机制

### 算法
- **算法**: AES-256-GCM (Galois/Counter Mode)
- **密钥长度**: 256位 (32字节)
- **IV长度**: 128位 (16字节)
- **认证标签**: 128位 (16字节)

### 加密流程

1. **密钥派生**: 使用 `scrypt` 从环境变量 `ENCRYPTION_KEY` 派生出32字节加密密钥
2. **随机IV**: 每次加密生成16字节随机初始化向量(IV)
3. **GCM加密**: 使用AES-256-GCM进行认证加密
4. **存储格式**: `base64(iv):base64(authTag):base64(encryptedData)`

### 解密流程

1. 解析存储的加密字符串，提取IV、认证标签和密文
2. 验证认证标签确保数据完整性
3. 使用相同密钥解密数据
4. 返回明文API Key

## 环境变量配置

### ENCRYPTION_KEY

```bash
# 生成强密钥（推荐）
openssl rand -base64 32

# 或在Node.js中生成
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**重要警告**:
- 密钥长度至少16个字符（推荐32个字符以上）
- **一旦设置并创建了加密数据后，绝对不要更改此密钥**
- 更改密钥将导致所有已加密的API Key无法解密
- 建议在生产环境中备份此密钥

### 配置示例

```bash
# .env 文件
ENCRYPTION_KEY=your_strong_encryption_key_here_min_32_chars
```

## 数据格式

### 存储在数据库中的格式

```json
{
  "id": "uuid",
  "name": "OpenAI Production",
  "provider": "openai",
  "keyEncrypted": "base64(iv):base64(authTag):base64(encryptedData)",
  "isActive": true,
  "useCount": 42
}
```

### API响应格式

```json
{
  "id": "uuid",
  "name": "OpenAI Production", 
  "provider": "openai",
  "keyMasked": "aGVsbG8****d29ybGQ=",
  "isActive": true,
  "useCount": 42
}
```

注意: API响应中只返回脱敏后的加密数据，**绝不返回明文API Key**。

## 使用场景

### 创建API Key
```typescript
// 前端发送明文key
const response = await apiKeyService.createApiKey({
  name: 'OpenAI Production',
  provider: 'openai',
  key: 'sk-xxxxxxxxxxxxxxxx',  // 明文
  description: 'Production API Key'
});

// 后端自动加密并存储
// 返回脱敏版本给前端
```

### 获取解密后的Key（后端内部使用）
```typescript
// 仅在后端服务内部使用，用于调用AI API
const decryptedKey = await apiKeyService.getDecryptedKey(apiKeyId);
// 返回: 'sk-xxxxxxxxxxxxxxxx' （明文）
```

## 安全特性

1. **端到端加密**: API Key在到达服务器后立即加密，不会以明文形式存储
2. **认证加密**: 使用GCM模式确保数据完整性和真实性
3. **随机IV**: 每次加密使用不同的IV，防止模式分析
4. **密钥隔离**: 加密密钥存储在环境变量中，与代码分离
5. **内存安全**: 解密仅在内存中进行，不缓存明文
6. **访问控制**: 只有后端服务可以解密，前端始终只看到加密数据

## 迁移说明

### 从明文存储迁移到加密存储

1. 设置 `ENCRYPTION_KEY` 环境变量
2. 重启应用服务
3. 重新添加所有API Key（旧的明文key将无法自动迁移）

### 轮换加密密钥

**警告**: 不支持直接轮换加密密钥，因为这需要解密所有数据并重新加密。

如需更换密钥，必须:
1. 导出所有API Key的明文（临时）
2. 更新 `ENCRYPTION_KEY` 环境变量
3. 重新导入所有API Key

## 故障排除

### 解密失败

如果看到解密失败的错误:
1. 检查 `ENCRYPTION_KEY` 是否正确设置
2. 确认密钥未被更改
3. 检查数据库中的加密数据格式是否正确

### 环境变量未设置

```
Error: ENCRYPTION_KEY environment variable is not set
```

解决方案: 在 `.env` 文件中添加 `ENCRYPTION_KEY`

## 代码参考

- 加密工具类: `/backend/src/shared/utils/encryption.util.ts`
- API Key服务: `/backend/src/modules/api-keys/api-key.service.ts`
- API Key模型: `/backend/src/shared/schemas/apiKey.schema.ts`
