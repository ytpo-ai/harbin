# Agents/Tools 架构迁移计划

## 背景与目标

- 当前 `apps/agents` 仍直接引用 `backend/src/modules/*`，属于“服务已拆分，代码未拆分”。
- 本轮目标：将 **Agent + Tools** 核心后端能力收敛到 `backend/apps/agents`。
- 明确边界：`meeting` 和 `chat` 暂不迁移，保留在业务域（legacy）。

## 迁移范围

### 本轮迁移

- `src/modules/agents/*` -> `apps/agents/src/modules/agents/*`
- `src/modules/tools/*` -> `apps/agents/src/modules/tools/*`

### 本轮不迁移

- `src/modules/meetings/*`
- `src/modules/chat/*`
- 其他业务模块（organization/hr/governance/employees 等）

## 执行计划

### 阶段 1：边界收敛（已开始）

1. 固化域边界：agents app 只承载 Agent + Tools。
2. 输出迁移文档与执行顺序。

### 阶段 2：代码搬迁与本地化（进行中）

1. 在 `apps/agents/src/modules` 新建 `agents`、`tools`。
2. 复制模块代码并修正 import 路径。
3. 改造 `apps/agents` 入口，优先引用本地模块。

### 阶段 3：兼容与验证

1. 运行 `npm run build:agents` 验证可编译。
2. 冒烟验证：
   - `GET /api/agents`
   - `POST /api/agents/:id/test`
   - `GET /api/tools`
   - `POST /api/tools/:id/execute`

### 阶段 4：后续建议（下一迭代）

1. 在 legacy 中引入 `AgentClient` 防腐层，不再直接注入 `AgentService/ToolService`。（进行中）
2. 把跨服务 DTO 收敛到 `libs/contracts`。
3. 给 gateway -> agents 链路加 `requestId` 与延迟指标。（已完成）

## 风险与回滚

- 风险：路径调整导致编译失败或模块注入失效。
- 缓解：按模块逐步迁移，每步执行构建验证。
- 回滚：若失败，恢复 `apps/agents` 对 `src/modules/*` 的旧引用。

## 进度记录

- [x] 创建迁移计划文档
- [x] 完成 `agents` 模块迁移到 `apps/agents`
- [x] 完成 `tools` 模块迁移到 `apps/agents`
- [x] `apps/agents` 全量构建通过
- [x] 更新架构文档（注明 meeting/chat 保持业务域）
- [x] Gateway 增加 `x-request-id` 透传与延迟日志
- [x] legacy 引入 `AgentClientService` / `ToolClientService`（第一批调用点）

## TODO（去遗留化）

- [ ] 完成剩余模块从本地 `AgentService`/`ToolService` 到 `AgentClientService`/`ToolClientService` 的切换
- [ ] 从 `backend/src/app.module.ts` 移除 `AgentModule`、`ToolModule`（legacy 不再直接承载该能力）
- [ ] 删除 `backend/src/modules/agents/` 与 `backend/src/modules/tools/` 的 legacy 实现
- [ ] 补充并通过去遗留化后的回归验证（构建 + 关键 API 冒烟）
