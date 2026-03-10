# 定时计划编排 MCP 能力补齐计划（开发沉淀）

## 关联主文档索引

- 计划主文档：`docs/plan/ORCHESTRATION_SCHEDULER_MCP_PLAN.md`
- 功能文档：`docs/feature/ORCHETRATION_SCHEDULER.md`
- API 文档：`docs/api/agents-api.md`

## 本次目标

将定时计划编排能力统一为“先创建 plan，再给该 plan 添加 schedule”的两步模型：

1. `builtin.sys-mg.mcp.orchestration.create-plan`
2. `builtin.sys-mg.mcp.orchestration.create-schedule`

并同步支持 `builtin.sys-mg.mcp.orchestration.update-schedule` 仅更新调度配置。

## 已完成实现

1. 新增定时计划 MCP 工具注册：`create-schedule`、`update-schedule`。
2. `create-schedule` 参数语义调整为以 `planId + schedule` 为核心，不再由调用方传 target/input。
3. ToolService 内实现 `plan -> schedule` 桥接：
   - 读取 `planId` 对应 plan 详情
   - 解析可执行 agent（优先 `strategy.plannerAgentId`，否则从任务分配中回退）
   - 自动组装底层 scheduler 所需 `target/input` 并创建 schedule
4. `update-schedule` 仅保留调度相关更新（cron/interval/timezone/enabled）。
5. Agent 编排意图补齐：
   - 识别“创建定时计划/创建调度计划”并优先要求已有 `planId`
   - 缺少 `planId` 时回退到 `listPlans` 引导用户补齐
6. 文档同步更新（API/功能/计划）。

## 关键文件

- `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `docs/api/agents-api.md`
- `docs/feature/ORCHETRATION_SCHEDULER.md`
- `docs/plan/ORCHESTRATION_SCHEDULER_MCP_PLAN.md`

## 验证结果

- 已执行：`backend` 构建 `npm run build`（通过）。
- 说明：仓库当前 `lint/typecheck` 脚本存在环境差异（不影响本次变更构建验证结论）。

## 后续建议

1. 在 legacy scheduler schema 显式增加 `planId` 字段，减少对 `input.payload.planId` 的隐式依赖。
2. 为 scheduler 触发链路增加“直接 run plan”模式，避免重复构建 standalone task 描述。
3. 在前端 Scheduler 页面补充“关联 plan”可视化展示与跳转。
