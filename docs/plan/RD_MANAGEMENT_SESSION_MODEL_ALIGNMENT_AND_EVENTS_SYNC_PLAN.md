# RD Management Session Model Alignment And Events Sync Plan

## 1. 背景与目标

- 修复 `lzw` 创建 session 时，session 记录中的模型与 Agent 已配置模型不一致的问题。
- 在研发会话页面明确展示 Agent 当前模型，避免用户通过会话/事件反推模型。
- 在研发会话页面恢复/补充“新建 Session”能力，并保证创建后数据联动刷新。
- 校验并修复 events 页面与 session/run 的同步一致性（模型、sessionId、时间线）。

## 2. 执行步骤

1. 梳理 session 创建链路：定位 Runtime/OpenCode 创建 session 时模型来源与写入位置，明确优先级。
2. 后端修复模型对齐：统一 session 模型字段写入逻辑，优先使用 Agent 配置模型并兼容 fallback。
3. 研发会话接口补齐：返回 Agent 可展示模型字段，并补齐新建 session 所需请求/响应结构。
4. 前端页面改造：在研发会话展示 Agent 模型，新增新建 session 入口，并在成功后刷新会话与事件面板。
5. events 同步校验：联调 session/run/events 数据映射，修正模型展示或关联字段不同步问题。
6. 回归验证与文档：完成关键链路验证并更新相关功能文档/日常记录。

## 3. 关键影响点

- 后端：`backend/apps/agents` Runtime session 创建与模型快照逻辑。
- 后端：`backend/src/modules/rd-management` 查询/创建 session 与 events 聚合接口。
- 前端：研发会话页面 Agent 模型展示、新建 session 交互、events 数据刷新策略。
- 测试：session 创建后模型字段、events 同步展示、回归路径稳定性。
- 文档：feature/dailylog/API 相关变更说明。

## 4. 风险与依赖

- 历史 session 数据可能缺失模型快照，需要前端展示兜底策略避免空白。
- events 页面若依赖旧字段名，修复时需兼容新旧返回结构。
- OpenCode 接口响应字段差异可能影响 session/run 模型透传。

## 5. 完成标准

- `lzw` 新建 session 的模型与其 Agent 配置模型一致。
- 研发会话页面可直接看到 Agent 模型，并可新建 session。
- 新建 session 后 events 页面信息正确同步（session 关联、模型、事件时间线一致）。
- 相关文档按规范更新。
