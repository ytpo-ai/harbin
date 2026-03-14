# API 文档总览（微服务拆分）

## 使用说明

- 前端统一通过 Gateway 访问：`http://localhost:3100/api`
- 服务归属以 Gateway 路由分流规则为准
- 本目录按“网关 + 各后端服务 + WS”拆分

## 文档索引

- `docs/api/gateway-api.md`
  - 统一入口、分流策略、内部签名头说明
- `docs/api/agents-api.md`
  - Agents 服务接口（agents/tools/skills/models/model-management）
- `docs/api/legacy-api.md`
  - Legacy 服务接口（meetings/hr/orchestration/messages/rd-management 等）
- `docs/api/engineering-intelligence-api.md`
  - 研发智能独立服务接口（仓库管理、文档摘要、docs 浏览）
- `docs/api/ws-api.md`
  - WebSocket 订阅协议、事件通道与消息格式
- `docs/api/opencode-api.md`
  - OpenCode Serve（4098）直连接口与 directory 参数规范

## 相关文档

- 架构总览：`docs/architecture/ARCHITECTURE.md`
- 微服务迁移：`docs/architecture/MICROSERVICES_MIGRATION.md`
