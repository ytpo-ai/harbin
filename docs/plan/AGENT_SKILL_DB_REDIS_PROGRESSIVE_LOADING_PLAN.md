# Agent Skill DB + Redis 渐进式加载实施计划

## 1. 背景

现有 Skill 管理具备完整的技能库、绑定与建议能力，但正文承载存在文件系统依赖。为满足多实例与云原生部署，计划将 Skill 正文切换为数据库内嵌存储，并通过 Redis 实现渐进式加载。

## 2. 目标

1. Skill 正文仅依赖 DB 存储，不依赖本地文件系统。
2. Skill 列表与路由链路保持轻量，只使用元数据。
3. Skill 正文仅在执行命中时按需加载并注入上下文。
4. 通过 Redis 缓存提升正文读取性能并保证可控失效。

## 3. 范围

### In Scope

- `skills` schema 增强（content/contentHash/contentUpdatedAt 等）。
- Skills API 渐进式响应契约（默认不返回 content）。
- SkillTool 执行时按需加载正文。
- Redis 缓存 key/TTL/失效策略。
- 历史 skill 正文回填迁移脚本。

### Out of Scope

- Skill 正文全文搜索引擎（ES/OpenSearch）接入。
- 前端富文本编辑器改造。

## 4. 实施步骤（顺序）

1. **模型扩展**
   - 为 `skills` 增加 `content/contentType/contentHash/contentSize/contentUpdatedAt/metadataUpdatedAt`。
   - 增加字段校验与大小上限（建议 256KB/512KB）。

2. **服务与接口改造**
   - `GET /skills` 默认排除 `content`。
   - `GET /skills/:id` 增加 `includeContent` 参数。
   - 新增可选 endpoint：`GET /skills/:id/content`。
   - 更新创建/更新逻辑：自动计算 `contentHash` 并维护更新时间。

3. **缓存层接入（Redis）**
   - 实现 `skill:index:{slug}`、`skill:detail:{id}`、`skill:content:{id}:{hash}` 三类 key。
   - 实现 cache-aside 读取与更新后失效机制。

4. **运行时执行链路接入**
   - SkillTool 读取流程改为：先查索引元数据，命中后拉取 content。
   - 保持权限确认与 `<skill_content>` 注入行为不变。

5. **迁移与回填**
   - 开发一次性迁移脚本，回填历史 skill content 到 DB。
   - 提供迁移校验脚本（抽样对比 hash 与长度）。

6. **测试与验收**
   - 单测：schema 校验、hash 计算、缓存失效。
   - 集成测试：列表轻量返回、详情按需返回、SkillTool 渐进式加载。
   - 回归：技能推荐、绑定、审核链路不回退。

## 5. 关键影响点

- backend：skills schema/service/controller、SkillTool 执行链路。
- database：`skills` 结构演进与历史数据回填。
- cache：Redis key 规范与失效策略。
- api：skills 读取契约变化（includeContent）。
- docs：feature/technical/api 文档同步更新。

## 6. 风险与应对

1. **正文过大导致响应变慢**
   - 应对：默认不返回 content + content 大小上限 + 按需接口。
2. **缓存脏读/失效不及时**
   - 应对：contentHash 版本化 key + 更新后主动删除旧 key。
3. **迁移不完整导致正文缺失**
   - 应对：迁移脚本加校验报告 + 双读兜底窗口。
4. **与现有文档同步逻辑冲突**
   - 应对：设置灰度期，稳定后再移除 file-sync 路径。

## 7. 验收标准

- [ ] `GET /skills` 默认响应不包含 `content`。
- [ ] `GET /skills/:id?includeContent=true` 可稳定返回正文。
- [ ] SkillTool 仅在命中技能执行时加载正文。
- [ ] Skill 更新后，Redis 正文缓存按 hash 正确失效。
- [ ] 迁移后无需文件系统即可完成 Skill 全链路。

## 8. 回滚策略

1. 保留旧字段与旧读取逻辑开关。
2. 出现异常时切回“仅 DB 轻量字段 + 旧正文来源”。
3. Redis 缓存可全量清理后回源 DB。

## 9. 里程碑建议

- M1：文档与方案冻结
- M2：Schema/API/Service 改造完成
- M3：Redis 缓存与 SkillTool 接入完成
- M4：迁移回填与灰度验证完成
- M5：去文件系统依赖并发布
