# Agent Identity & Evaluation 开发计划

## 阶段一：技术设计文档

- [x] 创建 `docs/technical/AGENT_IDENTITY_EVALUATION_DESIGN.md`

## 阶段二：Model 层扩展

- [x] 1. 扩展 `AgentMemo` schema，新增 `memoKind: 'evaluation'` 类型支持
  - 文件：`backend/apps/agents/src/schemas/agent-memo.schema.ts`
  - 修改：`MemoKind` 枚举新增 `'evaluation'`

- [x] 2. 更新前端 `AgentMemo` TypeScript 类型
  - 文件：`frontend/src/types/index.ts`
  - 修改：`memoKind` 类型新增 `'evaluation'`

## 阶段三：Identity 聚合服务开发

- [x] 3. 新增 `IdentityAggregationService` 服务
  - 文件：`backend/apps/agents/src/modules/memos/identity-aggregation.service.ts`
  - 依赖：`Agent`, `AgentSkill`, `Skill`, `OrchestrationTask` Model

- [x] 4. 实现从 Agent 表聚合基础信息
  - 方法：`getAgentBasicInfo(agentId)`
  - 字段：name, type, role, description, systemPrompt, tools, capabilities, personality, learningAbility

- [x] 5. 实现从 AgentSkill + Skill 表聚合技能矩阵
  - 方法：`getAgentSkills(agentId)`
  - 联合查询并格式化技能列表

- [x] 6. 实现从 OrchestrationTask 表聚合任务履历
  - 方法：`getTaskStatistics(agentId)`, `getRecentTasks(agentId, days)`
  - 统计完成率、平均时间等

- [x] 7. 实现 Markdown 内容构建器
  - 方法：`buildIdentityContent(data)`
  - 输出符合模板的 Markdown

- [x] 8. 注册到 MemoModule
  - 文件：`backend/apps/agents/src/modules/memos/memo.module.ts`
  - 注入 `IdentityAggregationService`

## 阶段四：Evaluation 文档服务开发

- [x] 9. 新增 `EvaluationAggregationService` 服务
  - 文件：`backend/apps/agents/src/modules/memos/evaluation-aggregation.service.ts`

- [x] 10. 实现工具使用统计聚合
  - 方法：`getToolUsageStats(agentId, period)`
  - 数据源：`AgentPart` 表（tool_call 类型）

- [x] 11. 实现 SLA 响应数据聚合
  - 方法：`getSlaMetrics(agentId, period)`
  - 数据源：`AgentRun` 表

- [x] 12. 实现 Markdown 内容构建器
  - 方法：`buildEvaluationContent(data)`

- [x] 13. 注册到 MemoModule

## 阶段五：触发机制对接

- [x] 14. 扩展 `MemoEventBusService` 事件类型
  - 文件：`backend/apps/agents/src/modules/memos/memo-event-bus.service.ts`
  - 新增事件：`'orchestration.task_completed'`

- [x] 15. 在 `MemoAggregationService` 中注册新服务
  - 注入 `IdentityAggregationService` 和 `EvaluationAggregationService`
  - 实现事件监听逻辑

- [x] 16. 在 MemoController 中添加手动触发 API
  - `POST /api/memos/identity/aggregate` - 手动触发 Identity 聚合
  - `POST /api/memos/evaluation/aggregate` - 手动触发 Evaluation 聚合

## 阶段六：定时聚合任务

- [x] 17. 实现每日全量聚合定时任务
  - 使用 `setInterval`（原生）
  - 默认每天凌晨执行（通过 `MEMO_FULL_AGGREGATION_INTERVAL_MS` 配置）

- [x] 18. 添加相关配置项
  - 环境变量：`MEMO_FULL_AGGREGATION_INTERVAL_MS`

## 阶段七：文档与测试

- [x] 19. 更新功能文档 `docs/features/AGENT_MEMO.md`
  - 新增 Identity 和 Evaluation 描述

- [x] 20. 运行 lint 检查
  - 构建通过

- [x] 21. 运行类型检查
  - `npm run build:agents` 通过

- [x] 22. 验证功能
  - 手动触发 API 已添加：`POST /api/memos/identity/aggregate` 和 `POST /api/memos/evaluation/aggregate`

---

## 关键影响点

| 模块 | 影响范围 | 优先级 |
|------|---------|--------|
| 后端 | 新增 2 个 aggregation service + Event Bus 扩展 | 高 |
| Schema | 新增 memoKind 枚举值 | 高 |
| 前端 | 类型同步（低优先级，可后续处理） | 低 |

## 预计工作量

- 阶段二：0.5 小时
- 阶段三：2 小时
- 阶段四：1.5 小时
- 阶段五：1 小时
- 阶段六：0.5 小时
- 阶段七：1 小时

**总计：约 6.5 小时**

## 依赖关系

```
阶段二 (Schema)
    │
    ▼
阶段三 (Identity) ─────┐
                       │
阶段四 (Evaluation) ───┼──▶ 阶段五 (触发机制) ──▶ 阶段六 (定时) ──▶ 阶段七
                       │
    (独立，可并行)      │
```
