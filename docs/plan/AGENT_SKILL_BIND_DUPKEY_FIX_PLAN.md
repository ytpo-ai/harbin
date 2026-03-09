# Agent Skill 绑定 `id: null` 唯一索引冲突修复计划

## 背景

- 现象：Agent 绑定技能接口报错 `E11000 duplicate key error collection: mait.agentskills index: id_1 dup key: { id: null }`。
- 影响：技能绑定失败，且在 `findOneAndUpdate + upsert` 场景下会持续复现。

## 执行步骤

1. 明确问题根因：定位 `assignSkillToAgent` 的 upsert 写入路径，确认未在插入分支写入 `id`，触发唯一索引 `id_1` 的 `null` 冲突。
2. 后端代码修复：将 upsert 更新语句改为 `$set + $setOnInsert`，在插入分支强制写入 `id: uuidv4()`，并启用 `setDefaultsOnInsert`。
3. 数据兼容策略：补充存量脏数据处理方案（对 `agentskills` 中 `id` 为空记录进行回填），避免后续运维排障成本。
4. 回归验证：验证首次绑定、重复绑定（幂等更新）与多技能绑定流程，确保不再出现 `id: null` 冲突。
5. 文档与交付：同步本次修复结果与验证结论，输出可执行的数据库修复命令建议。

## 关键影响点

- backend：`apps/agents` 技能绑定逻辑（Mongo upsert）。
- API：绑定技能接口稳定性与幂等行为。
- database：`mait.agentskills` 集合唯一索引与历史数据兼容。
- test：绑定流程回归验证。

## 风险与依赖

- 若库中已存在 `id` 为空的历史记录，代码修复可阻止新增问题，但仍建议执行一次数据回填以消除隐患。
- 依赖现有索引策略保持不变：`id` 唯一索引 + `{ agentId, skillId }` 复合唯一索引。
