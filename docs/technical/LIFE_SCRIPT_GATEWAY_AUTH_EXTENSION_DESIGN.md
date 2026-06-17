# LifeScript 集成 — Gateway 与认证扩展技术设计

## 1. 概述

本文档覆盖 Harbin 侧为集成 LifeScript 所需的 Gateway 路由扩展和认证改造。LifeScript 侧的后端适配和管理台前端设计见 [`workspace/life_script/docs/technical/LIFE_SCRIPT_ADMIN_INTEGRATION_DESIGN.md`](../../workspace/life_script/docs/technical/LIFE_SCRIPT_ADMIN_INTEGRATION_DESIGN.md)。

### 关联文档

| 文档 | 链接 |
|------|------|
| Plan (Harbin 侧) | [LIFE_SCRIPT_ADMIN_INTEGRATION](../plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md) |
| Plan (LifeScript 侧) | [`workspace/life_script/docs/plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md`](../../workspace/life_script/docs/plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md) |
| REQ-001 Gateway 路由 | [LIFE_SCRIPT_REQ-001_GATEWAY_ROUTING](../requirement/LIFE_SCRIPT_REQ-001_GATEWAY_ROUTING.md) |
| REQ-002 Token 认证 | [LIFE_SCRIPT_REQ-002_TOKEN_AUTH](../requirement/LIFE_SCRIPT_REQ-002_TOKEN_AUTH.md) |

---

## 2. Gateway 路由扩展

### 2.1 路由规则变更

**文件**：`backend/apps/gateway/src/gateway-proxy.service.ts`

在 `resolveTarget()` 方法中新增（放在 agents 路由之后、legacy fallback 之前）：

```typescript
// LifeScript service
if (path.startsWith('/api/life-script')) {
  return process.env.LIFE_SCRIPT_BASE_URL || 'http://localhost:3101';
}

if (path === '/api/auth/issue-redirect-token') {
  return process.env.LIFE_SCRIPT_BASE_URL || 'http://localhost:3101';
}
```

### 2.2 Path Rewrite

**文件**：`backend/apps/gateway/src/gateway-proxy.service.ts`

在 `forward()` 方法中，转发到 LifeScript 时剥离 `/life-script` 前缀：

```typescript
async forward(req: Request, res: Response, userContext?: GatewayUserContext) {
  const target = this.resolveTarget(req.path);
  let targetPath = req.path;

  // LifeScript: strip /life-script prefix
  if (req.path.startsWith('/api/life-script')) {
    targetPath = req.path.replace('/api/life-script', '/api');
  }

  const url = `http://${target.host}:${target.port}${targetPath}`;
  // ... rest of forward logic ...
}
```

**转发映射**：

| 前端请求 | Gateway 转发目标 |
|---------|-----------------|
| `GET /api/life-script/admin/submissions` | `GET http://localhost:3101/api/admin/submissions` |
| `POST /api/life-script/auth/exchange` | `POST http://localhost:3101/api/auth/exchange` |
| `POST /api/life-script/submissions` | `POST http://localhost:3101/api/submissions` |
| `GET /api/life-script/admin/dashboard/stats` | `GET http://localhost:3101/api/admin/dashboard/stats` |
| `POST /api/auth/issue-redirect-token` | `POST http://localhost:3101/api/auth/issue-redirect-token` |

### 2.3 CORS 配置

**文件**：`backend/apps/gateway/src/main.ts`

```typescript
const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3200')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.enableCors({ origin: corsOrigins, credentials: true });
```

新增环境变量：

```env
CORS_ORIGINS=http://localhost:3000,http://localhost:3200
```

---

## 3. Redirect Token 签发

### 3.1 新增接口

**文件**：`backend/src/modules/auth/auth.controller.ts`

```typescript
@Post('issue-redirect-token')
async issueRedirectToken(@Req() req: Request) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const payload = this.authService.verifyToken(token);
  return this.authService.generateRedirectToken(payload.employeeId, 'life-script');
}
```

### 3.2 Service 实现

**文件**：`backend/src/modules/auth/auth.service.ts`

```typescript
async generateRedirectToken(
  employeeId: string,
  target: string,
): Promise<{ redirectToken: string; expiresIn: number }> {
  // 频率限制：10 次/分钟/用户
  const rateLimitKey = `redirect:rate:${employeeId}`;
  const count = await this.redisService.incr(rateLimitKey);
  if (count === 1) {
    await this.redisService.expire(rateLimitKey, 60);
  }
  if (count > 10) {
    throw new HttpException('Too many requests', 429);
  }

  // 生成 token
  const redirectToken = crypto.randomBytes(32).toString('hex');
  const key = `redirect:${target}:${redirectToken}`;
  const ttl = 30;

  // 获取员工信息
  const employee = await this.employeeModel.findById(employeeId);
  const payload = {
    employeeId,
    email: employee.email,
    name: employee.name,
    role: employee.role,
    issuedAt: Date.now(),
  };

  await this.redisService.set(key, JSON.stringify(payload), 'EX', ttl);

  return { redirectToken, expiresIn: ttl };
}
```

### 3.3 Redis Key 设计

| Key Pattern | Value | TTL | 用途 |
|-------------|-------|-----|------|
| `redirect:life-script:{token}` | JSON: `{ employeeId, email, name, role, issuedAt }` | 30s | 一次性跳转 token |
| `redirect:rate:{employeeId}` | integer counter | 60s | 签发频率限制 |

---

## 4. Gateway LS Token 验证

### 4.1 Auth Guard 扩展

**文件**：`backend/apps/gateway/src/gateway-auth.guard.ts`

```typescript
// 白名单扩展
private readonly publicPaths = [
  // ... existing paths ...
  '/api/life-script/auth/exchange',    // token 交换
  '/api/life-script/submissions',       // C端提交 (POST)
  '/api/life-script/upload',            // C端上传
];

async canActivate(context: ExecutionContext): Promise<boolean> {
  // ... 白名单检查 ...

  const path = request.path;
  const bearerToken = this.extractToken(request);

  // LifeScript 路由：使用 LS_JWT_SECRET 验证
  if (path.startsWith('/api/life-script')) {
    return this.verifyLifeScriptToken(bearerToken, request);
  }

  // 默认：Harbin JWT 验证（现有逻辑不变）
  return this.verifyHarbinToken(bearerToken, request);
}
```

### 4.2 LS Token 验证逻辑

```typescript
private verifyLifeScriptToken(token: string, request: Request): boolean {
  if (!token) {
    throw new UnauthorizedException('Missing token');
  }

  const secret = this.configService.get<string>('LS_JWT_SECRET');
  if (!secret) {
    throw new UnauthorizedException('LS_JWT_SECRET not configured');
  }

  const [headerB64, payloadB64, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (sig !== expectedSig) {
    throw new UnauthorizedException('Invalid LifeScript token');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  if (payload.exp < Date.now()) {
    throw new UnauthorizedException('Token expired');
  }

  // 构建 userContext，与 Harbin JWT 流程一致
  const userContext: GatewayUserContext = {
    employeeId: payload.employeeId,
    email: payload.email,
    role: payload.role,
    issuedAt: payload.iat || Date.now(),
    expiresAt: payload.exp,
  };
  request['userContext'] = userContext;

  return true;
}
```

**设计选择**：Gateway 本地验证 LS token（而非透传给 LifeScript 后端），保持 Gateway 的统一审计能力。

---

## 5. Harbin 前端跳转入口

### 5.1 Layout 侧边栏

**文件**：`frontend/src/components/Layout.tsx`

在"系统管理"分组中新增外链入口：

```typescript
{
  name: 'LifeScript',
  icon: SparklesIcon,
  external: true,
  onClick: handleLifeScriptRedirect,
}
```

### 5.2 跳转逻辑

```typescript
const handleLifeScriptRedirect = async () => {
  try {
    const { data } = await axios.post('/api/auth/issue-redirect-token', {}, {
      headers: { Authorization: `Bearer ${authService.getToken()}` },
    });
    const adminUrl = import.meta.env.VITE_LIFE_SCRIPT_ADMIN_URL || 'http://localhost:3200';
    window.open(`${adminUrl}/auth/callback?token=${data.redirectToken}`, '_blank');
  } catch (error) {
    console.error('Failed to generate redirect token', error);
  }
};
```

### 5.3 环境变量

```env
# frontend/.env
VITE_LIFE_SCRIPT_ADMIN_URL=http://localhost:3200
```

---

## 6. 新增环境变量汇总

| 变量 | 文件 | 默认值 | 说明 |
|------|------|--------|------|
| `LIFE_SCRIPT_BASE_URL` | `backend/.env` | `http://localhost:3101` | LifeScript 后端统一地址 |
| `LS_JWT_SECRET` | `backend/.env` | — | LifeScript JWT 密钥（需与 LifeScript 一致） |
| `CORS_ORIGINS` | `backend/.env` | `http://localhost:3000,http://localhost:3200` | 允许的 CORS origin 列表 |
| `VITE_LIFE_SCRIPT_ADMIN_URL` | `frontend/.env` | `http://localhost:3200` | 管理台前端地址 |

---

## 7. Token 跳转完整时序

```
Harbin Frontend                Harbin Backend           Redis           LifeScript Backend        LifeScript Admin
     │                              │                     │                    │                       │
     │ POST /api/auth/              │                     │                    │                       │
     │   issue-redirect-token       │                     │                    │                       │
     │─────────────────────────────→│                     │                    │                       │
     │                              │ SET redirect:       │                    │                       │
     │                              │ life-script:xxx     │                    │                       │
     │                              │ EX 30               │                    │                       │
     │                              │────────────────────→│                    │                       │
     │    { redirectToken: "xxx" }  │                     │                    │                       │
     │←─────────────────────────────│                     │                    │                       │
     │                              │                     │                    │                       │
     │ window.open("http://localhost:3200/auth/callback?token=xxx")           │                       │
     │───────────────────────────────────────────────────────────────────────────────────────────────→│
     │                              │                     │                    │                       │
     │                              │                     │  POST /api/life-script/auth/exchange       │
     │                              │                     │  { redirectToken: "xxx" }                  │
     │                              │                     │         ← Gateway 放行(白名单) →           │
     │                              │                     │←───────────────────│←──────────────────────│
     │                              │                     │                    │                       │
     │                              │                     │ GET+DEL redirect:  │                       │
     │                              │                     │ life-script:xxx    │                       │
     │                              │                     │───────────────────→│                       │
     │                              │                     │                    │                       │
     │                              │                     │  { sessionToken }  │                       │
     │                              │                     │                    │──────────────────────→│
     │                              │                     │                    │                       │
     │                              │                     │                    │    localStorage.set   │
     │                              │                     │                    │    redirect /dashboard│
```
