# 文档中组织期权与创始团队股份分配内容清理计划

## 目标

在现有文档中移除与“组织期权”“创始团队股份分配（及相近表述）”相关内容，确保文档叙述聚焦产品能力与协作流程，不再包含股权/期权分配描述。

## 执行步骤

1. 扫描 `README.md`、`feature.md` 与 `docs/**/*.md`，定位涉及股权、期权、股份分配、创始团队持股等表述。
2. 按上下文区分处理方式：
   - 直接删除仅用于股权/期权说明的段落；
   - 对仍有价值的功能描述改写为中性表达（如角色、权限、协作流程）。
3. 修改命中文档，移除相关内容并保持章节结构、编号与可读性。
4. 检查并修复因删除引起的目录、锚点、交叉引用不一致问题。
5. 输出变更清单，说明已清理文件与主要删改点，便于复核。

## 关键影响点

- 文档层：`README.md`、`feature.md`、`docs/feature`、`docs/overview`、`docs/guide`、`docs/development`。
- 可能影响：历史记录类文档中的叙述完整性（需在“保留历史”与“去除敏感表述”间平衡）。

## 风险与依赖

- 同义词较多（如“员工池”“股份加权”“激励机制”），存在漏改风险，需二次检索复核。
- 若 API 路径/字段名本身包含历史命名（非本次代码改造范围），仅调整文字说明，不改动接口标识。

---

## 新增需求：README 架构引用与微服务架构文档更新

### 目标

- 删除 README 中过时的“项目结构”静态目录树。
- 在 README 中改为引用 `docs/architecture/ARCHITECTURE.md` 作为唯一架构说明入口。
- 根据当前微服务现状更新 `docs/architecture` 下文档，确保服务边界、路由策略与运行方式一致。

### 执行步骤

1. 审查 README 当前架构/项目结构内容，移除过时目录树并增加架构文档链接。
2. 盘点 `docs/architecture/ARCHITECTURE.md` 与 `docs/architecture/MICROSERVICES_MIGRATION.md` 的现状描述与过时项。
3. 按当前代码结构更新微服务边界（gateway/agents/ws/legacy/engineering-intelligence）与请求链路。
4. 同步更新 API 分流、端口、部署与迁移阶段说明，明确“已下线模块”和“迁移中模块”。
5. 复核 README 与 architecture 文档之间的术语和链接一致性。

### 关键影响点

- `README.md`：开发指南中“项目结构”章节改为文档引用。
- `docs/architecture/ARCHITECTURE.md`：主架构事实源更新。
- `docs/architecture/MICROSERVICES_MIGRATION.md`：迁移态与运行态说明更新。

### 风险与依赖

- 若迁移尚未完全完成，需在文档中区分“当前已上线”与“规划态”，避免误导。
- 若后续路由拆分继续演进，需以 Gateway 路由实现为准持续维护架构文档。

---

## 新增需求：API 文档按微服务拆分 + README API 段精简

### 目标

- 将 `docs/api/API.md` 从单文件整理为按微服务拆分的多文档结构。
- README 中移除详细 API 接口清单，仅保留 API 文档链接。

### 执行步骤

1. 梳理现有 `docs/api/API.md` 接口并按微服务归属分组（gateway/agents/legacy/ws/engineering-intelligence）。
2. 在 `docs/api/` 下新增分服务文档，并保留 `API.md` 作为统一索引页。
3. 更新索引页，给出每份文档职责与入口地址。
4. 删除 README 中冗长 API 细节段，仅保留 API 文档链接列表。
5. 复核链接可达性与术语一致性，确保与当前微服务路由策略一致。

### 关键影响点

- `docs/api/API.md`（由明细改为导航索引）
- `docs/api/*.md`（新增分服务 API 文档）
- `README.md`（API 章节精简）

### 风险与依赖

- 当前处于迁移态，部分接口仍在 legacy；文档需标明“服务归属以 Gateway 分流规则为准”。
