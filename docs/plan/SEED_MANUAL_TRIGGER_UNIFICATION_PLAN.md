# Seed 手动触发统一改造计划

## 1. 需求理解

- 当前系统存在多处启动期 seed/初始化副作用（constructor/onModuleInit/main.ts）。
- 目标是将所有 seed 统一改为“手动触发”，避免服务重启时自动写入或重建系统数据。
- 重点包括：Model Management Agent、MCP Profile、内置工具、模型库默认模型、Meeting Monitor 系统计划。

## 2. 执行步骤

1. 全量盘点当前启动期 seed 入口并分类（agents app / legacy app / destructive migration）。
2. 新增统一手动 seed 执行脚本，支持 `all`、`only`、`dry-run`、`force` 参数。
3. 将各模块 seed 逻辑改为可被脚本调用的公开方法，保持幂等行为。
4. 移除启动自动触发点（constructor/onModuleInit/main.ts 中的 seed 调用）。
5. 增加最小验证命令与输出摘要，确保重复执行无副作用。
6. 更新功能文档，明确“启动不自动 seed，改为运维手动执行”。

## 3. 关键影响点

- 后端 Agents：`AgentService`、`ToolService`、`ModelManagementService`、`main.ts`
- 后端 Legacy：`SchedulerService`（Meeting Monitor）
- 运维流程：部署后需显式执行 seed 脚本
- 文档：Meeting/Agent/Model 管理相关说明

## 4. 风险与依赖

- 新环境若未执行 seed 脚本，系统基础对象可能缺失。
- 一次性改动面较大，需保证每类 seed 的幂等与错误提示。
- `force` 模式需要谨慎，避免覆盖用户自定义配置。

## 5. 验证标准

- 服务重启后，不再自动创建/更新 seed 数据。
- 手动执行 `seed --all` 后，系统对象完整可用。
- 重复执行 seed 不产生重复数据。
- `Model Management Agent` 删除后重启不会自动恢复；仅手动 seed 才恢复。
