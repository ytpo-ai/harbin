# OpenCode Serve API（4098）

## 基础信息

- 服务地址：`http://localhost:4098`
- 认证方式：Basic Auth
  - 用户名：`opencode`
  - 密码：`$OC_PASS`
- 推荐先设置环境变量：`export OC_PASS='your_password'`

## 关键约束

- 创建会话必须携带目录参数：`POST /session?directory=<absolute_path>`。
- `projectID` 不是当前创建归属的主依据，实际归属由 `directory` 解析结果决定。
- 若 `directory` 不在可识别项目中，可能落入全局项目（例如 `projectID=global`）。

## 1) 创建 Session

- 方法：`POST /session?directory=/root/workspace/lzw/harbin`
- 请求体字段：
  - `title`（可选）
  - `parentID`（可选，fork 场景）
  - `permission`（可选）

示例：

```bash
curl -u "opencode:${OC_PASS}" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:4098/session?directory=/root/workspace/lzw/harbin" \
  -d '{"title":"coder-lzw strict test"}'
```

成功响应示例：

```json
{
  "id": "ses_xxx",
  "projectID": "20493ca80ae5d9f580557aead239a6a6036925d8",
  "directory": "/root/workspace/lzw/harbin",
  "title": "coder-lzw strict test"
}
```

## 2) 查询目录下 Session 列表

- 方法：`GET /session?directory=/root/workspace/lzw/harbin`

示例：

```bash
curl -u "opencode:${OC_PASS}" \
  "http://localhost:4098/session?directory=/root/workspace/lzw/harbin"
```

## 3) 发送消息到 Session

- 方法：`POST /session/:id/message`
- 请求体：`parts` 数组（文本消息）

示例：

```bash
curl -u "opencode:${OC_PASS}" \
  -H "Content-Type: application/json" \
  -X POST "http://localhost:4098/session/ses_xxx/message" \
  -d '{"parts":[{"type":"text","text":"reply strict-real-event"}]}'
```

## 4) 校验当前目录项目归属

- 方法：`GET /project/current?directory=/root/workspace/lzw/harbin`

示例：

```bash
curl -u "opencode:${OC_PASS}" \
  "http://localhost:4098/project/current?directory=/root/workspace/lzw/harbin"
```

## 5) 订阅真实事件流

- 方法：`GET /event`（SSE）
- 说明：流内事件包含 `sessionID`，可按目标 `sessionId` 过滤。

示例：

```bash
curl -N -u "opencode:${OC_PASS}" \
  "http://localhost:4098/event"
```

## 常见问题

- `401 Unauthorized`
  - 检查用户名是否为 `opencode`
  - 检查密码是否与 serve 启动时一致
- 创建成功但 project 不对
  - 检查是否传了 `?directory=...`
  - 检查目录是否为绝对路径且在目标机器真实存在
