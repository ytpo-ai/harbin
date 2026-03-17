# Identity 备忘录工具展示修复

## 1. 基本信息

- 标题：Identity 备忘录写入移除工具描述并改为工具 ID 列表展示
- 日期：2026-03-17
- 负责人：OpenCode
- 关联需求/会话：用户提出“备忘录 Identify 写入去掉工具描述，并把工具集以 id 列表方式展示”
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：Identity 聚合内容中包含“工具描述”表格，工具集不是按 ID 列表逐项展示。
- 触发条件：执行 identity 聚合并写入 `memoKind=identity` 文档。
- 影响范围：Agent Memo 的 identity 文档可读性与输出格式一致性。
- 严重程度：低

## 3. 根因分析

- 直接原因：`IdentityAggregationService.buildIdentityContent` 在“能力域”中固定输出“工具描述”章节与描述列。
- 深层原因：Identity 模板仍沿用早期“工具元数据展示”格式，未按最新展示口径收敛为工具 ID 列表。
- 相关模块/文件：
  - `backend/apps/agents/src/modules/memos/identity-aggregation.service.ts`
  - `backend/apps/agents/src/modules/memos/identity-aggregation.service.spec.ts`

## 4. 修复动作

- 修复方案：
  - 移除 identity 内容中的“工具描述”段落。
  - 将“工具集”改为“工具集（ID 列表）”，按逐行列表输出。
  - 工具采集只保留去重后的工具 ID。
- 代码改动点：
  - `getTools` 仅返回工具 ID。
  - `buildIdentityContent` 改为输出 ID 列表并删除描述表格。
  - 单元测试改为断言 ID 列表与去重行为。
  - 功能文档同步更新 Identity 模板描述。
- 兼容性处理：
  - 工具 ID 做 trim + 去重，未知工具 ID 仍保留展示，不依赖工具注册表元数据。

## 5. 验证结果

- 验证步骤：
  - 运行 identity 聚合单元测试，检查能力域输出。
  - 核对文档描述是否与实现一致。
- 验证结论：通过
- 测试与检查：
  - `backend/apps/agents/src/modules/memos/identity-aggregation.service.spec.ts`

## 6. 风险与后续

- 已知风险：若下游流程依赖“工具描述”文本做解析，需要同步调整。
- 后续优化：可在其他聚合文档统一“工具信息”展示口径，避免格式分叉。
- 是否需要补充功能文档/API文档：是（已更新功能文档）
