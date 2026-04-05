# 基于一次性 Token 的飞书 Bot 安全绑定 Plan

## 1. 背景

当前飞书绑定流程使用 `/bind <邮箱>`，存在“邮箱可被猜测或获知后冒充绑定”的风险。目标是切换为“一次性 token + 短时有效 + 消费即失效”的绑定机制，缩小攻击窗口并提升绑定可信度。

## 2. 方案结论

- 采用前端发起、后端签发、飞书侧提交的三段式绑定流程。
- token 使用 Redis 存储，TTL 300 秒。
- token 仅可使用一次，绑定时原子消费。
- 邮箱绑定降级仅保留管理员后门，普通用户默认关闭（通过开关控制）。

## 3. 可执行步骤

### Step 1：Auth 模块新增 Token 签发 API

**影响点**：后端 API / Redis

- 新增 `POST /auth/me/feishu-bind-token`（JWT 鉴权）。
- 使用 `crypto.randomBytes(16).toString('hex')` 生成 32 位 token。
- Redis 写入 `channel:feishu-bind:{token} -> employeeId`，TTL `300` 秒。
- 返回结构：`{ token, expiresIn: 300, command: '/bind token:<token>' }`。
- 增加轻量限流（建议同账号 1 分钟最多 3 次）。

### Step 2：Channel Inbound `/bind` 指令改造为 Token 优先

**影响点**：`apps/channel` 入站处理

- 新增 `/bind token:<token>` 解析分支。
- 使用原子消费读取 token（优先 `GETDEL` 或 Lua 脚本等价实现）。
- 命中 token：读取 `employeeId` 执行 `bindUser()`，并保证 token 不可复用。
- token 无效/过期：返回“token 无效或已过期”。
- 邮箱绑定降级分支：通过开关控制，仅管理员可用，默认关闭。

### Step 3：前端用户下拉菜单新增「绑定飞书」入口

**影响点**：前端 Layout / 用户交互

- 在用户下拉菜单「复制 Token」与「退出登录」之间新增「绑定飞书」按钮。
- 点击后调用 `POST /auth/me/feishu-bind-token`。
- 展示可复制文本 `/bind token:<token>` 与过期倒计时文案。
- 引导文案：“请在飞书中 @Bot 并发送以下内容完成绑定”。

### Step 4：更新帮助文案与兼容提示

**影响点**：Channel Help 文案

- `/help` 中将主说明更新为 `/bind token:<token>`。
- 若保留管理员邮箱降级能力，在帮助文案中仅对管理员提示。

## 4. 关键影响点

| 范围 | 变更 |
|---|---|
| 后端 auth 模块 | 新增 1 个绑定 token API |
| Redis | 新增临时 key：`channel:feishu-bind:{token}`（TTL 5 分钟） |
| channel inbound | `/bind` 解析改造，支持 token 原子一次性消费 |
| 前端 Layout | 用户下拉菜单新增「绑定飞书」按钮与复制指令交互 |
| 数据库 | 无 schema 变更 |

## 5. 风险与应对

| 风险 | 应对 |
|---|---|
| token 被截获转发 | TTL 5 分钟 + 一次性消费，降低可利用窗口 |
| 用户频繁点击生成 token | API 限流 + 每次新 token（旧 token 自然过期） |
| 兼容历史邮箱绑定 | 默认关闭普通用户邮箱绑定，仅管理员可控开启 |
