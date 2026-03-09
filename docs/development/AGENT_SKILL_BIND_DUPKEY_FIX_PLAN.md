# Agent Skill 绑定 `id: null` 唯一索引冲突修复开发总结

## 1. 问题现象

- 绑定技能接口在 `findOneAndUpdate + upsert` 场景下报错：
  - `E11000 duplicate key error collection: mait.agentskills index: id_1 dup key: { id: null }`

## 2. 根因分析

- `agentskills` 集合中 `id` 字段被定义为唯一索引。
- 绑定逻辑使用 `findOneAndUpdate({ agentId, skillId }, ..., { upsert: true })`。
- 原实现仅传递普通更新对象，未区分更新与插入分支，导致 upsert 插入时未写入 `id`，落库为 `null`（或缺失后映射为 `null`），触发唯一索引冲突。

## 3. 修复方案

- 文件：`backend/apps/agents/src/modules/skills/skill.service.ts`
- 方法：`assignSkillToAgent`
- 调整要点：
  1. 使用 `$set` 更新可变业务字段（`proficiencyLevel` / `assignedBy` / `enabled` / `note`）。
  2. 使用 `$setOnInsert` 在 upsert 的插入分支写入 `id: uuidv4()`、`agentId`、`skillId`。
  3. 启用 `setDefaultsOnInsert: true`，确保插入分支默认值行为一致。

## 4. 验证结果

- 本地执行 `npm run build:agents`（backend）通过。
- 预期行为：
  - 首次绑定：成功创建记录并生成非空唯一 `id`。
  - 重复绑定同一 `(agentId, skillId)`：命中更新分支，不再触发 `id_1` 冲突。

## 5. 数据兼容建议

- 代码修复仅阻止新增脏数据。
- 建议排查并处理历史 `id` 为空记录：
  - `db.agentskills.find({ $or: [{ id: null }, { id: { $exists: false } }] })`
- 若存在记录，按文档逐条回填唯一 UUID 后保存，确保后续索引与幂等更新稳定。
