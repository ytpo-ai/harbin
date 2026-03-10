# Agent Skill DB + Redis 渐进式加载技术设计

## 1. 背景与目标

当前 Skill 能力已经具备主表、绑定、建议闭环，但正文承载依赖文档落盘链路。为适配容器化与多实例部署，目标调整为：

- 不依赖本地文件系统，Skill 正文以数据库为事实源。
- 通过 Redis 实现“元数据常驻、正文按需”的渐进式加载。
- 保持 Agent 运行期体验：仅在命中技能时注入正文上下文。

## 2. 设计原则

1. DB 是唯一事实源（Source of Truth）。
2. Redis 是缓存层，不保存唯一状态。
3. 列表链路绝不加载正文。
4. 正文按 hash 版本化缓存，更新可精确失效。
5. 兼容历史字段与调用方，分阶段演进。

## 3. 数据模型设计（skills）

在现有 `skills` 基础上补充正文相关字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `metadata` | `Record<string, any>` | 轻量元数据（frontmatter 标准化结果） |
| `content` | `string` | 技能正文（Markdown） |
| `contentType` | `string` | 内容类型，默认 `text/markdown` |
| `contentHash` | `string` | 正文 hash（建议 sha256） |
| `contentSize` | `number` | 正文字节数，用于限流和监控 |
| `contentUpdatedAt` | `Date` | 正文最后更新时间 |
| `metadataUpdatedAt` | `Date` | 元数据最后更新时间 |

约束建议：

- `content` 允许为空（纯元数据 skill）。
- 当 `content` 更新时必须同步更新 `contentHash/contentSize/contentUpdatedAt`。
- 设置正文大小上限（建议 256KB 或 512KB）。

## 4. 读取链路（渐进式加载）

### 4.1 列表与检索

- `GET /skills` 默认返回轻量字段。
- 默认排除：`content`。
- 可选参数：`includeMetadata=true` 时返回完整 metadata（默认返回摘要或最小集合）。

### 4.2 详情与执行

- `GET /skills/:id` 默认不返回 `content`。
- `GET /skills/:id?includeContent=true` 或独立 `GET /skills/:id/content` 才返回正文。
- SkillTool 执行阶段按名称/ID 命中 skill 后，才读取正文并注入运行上下文。

## 5. Redis 缓存设计

### 5.1 Key 规范

- `skill:index:{slug}`：技能轻量索引元数据。
- `skill:detail:{id}`：技能详情（不含 content）。
- `skill:content:{id}:{contentHash}`：技能正文。

### 5.2 TTL 建议

- `skill:index:*`：30-120 分钟（可按命中率调优）。
- `skill:detail:*`：10-30 分钟。
- `skill:content:*`：10-30 分钟（hash 化后允许更长）。

### 5.3 失效策略

- Skill 元数据更新：删除 `skill:index:{slug}` 与 `skill:detail:{id}`。
- Skill 正文更新：删除旧 hash 对应的 `skill:content:{id}:{oldHash}`。
- 读取采用 cache-aside，miss 回源 DB 并回填缓存。

## 6. 一致性与并发

- 写入时采用单文档原子更新，先算 hash 再落库。
- 如存在并发写入，按 `updatedAt` 或版本号做最后写入生效。
- 对高并发读取可增加短时互斥（singleflight）避免缓存击穿。

## 7. 迁移策略

1. Schema 扩展：增加 `content` 相关字段，兼容旧文档。
2. 历史数据回填：从现有 Skill 文档来源回填 `content` 到 DB。
3. 双读阶段：优先 DB；缺失时可临时回退旧来源并回写 DB。
4. 稳定后移除文件系统同步逻辑，保留 DB + Redis 单轨。

迁移脚本：

- `backend/scripts/migrate-skill-content-to-db.ts`
- 执行：`npm run migrate:skill-content -- --dry-run`

## 8. 监控与告警

- 指标：
  - `skill_content_cache_hit_rate`
  - `skill_content_db_read_total`
  - `skill_content_size_bytes`
  - `skill_content_injection_total`
- 告警：
  - 缓存命中率持续低于阈值
  - 单条 content 超过大小限制
  - 正文读取失败率异常上升

## 9. 安全与治理

- 正文入库前执行敏感信息扫描（密钥、token、凭据模式）。
- 注入模型上下文前执行长度裁剪与白名单过滤。
- 保留审计字段：`updatedBy`、`updatedAt`、`contentHash` 变更记录。

## 10. 验收标准

1. 列表接口在默认模式下不返回 `content`。
2. 命中技能执行时可稳定读取正文并注入上下文。
3. Skill 更新后，Redis 缓存能按 hash 正确失效。
4. 关闭文件系统后，Skill 全链路功能保持可用。
