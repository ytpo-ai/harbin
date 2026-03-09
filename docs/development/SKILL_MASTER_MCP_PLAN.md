# SKILL_MASTER_MCP 开发总结

## 1. 实施结果

- 已新增 Skill MCP toolkit：`skill-master`。
- 已提供两个内置工具：
  - `builtin.sys-mg.mcp.skill-master.list-skills`：列出系统 skill，支持 `title` 模糊检索。
  - `builtin.sys-mg.mcp.skill-master.create-skill`：创建 skill。
- 工具执行路径已接入现有 Tool Registry / Tool Execute 流程，返回结构化结果。

## 2. 代码改动

### 2.1 Tools 模块

- `backend/apps/agents/src/modules/tools/tool.service.ts`
  - 注册 `skill-master` 两个内置工具（list/create）。
  - 执行分发新增 skill-master 分支。
  - 新增 `listSkillsByTitle`：
    - 支持 `title` 映射到 skill name 模糊搜索。
    - 支持 `status/category/limit/page`。
  - 新增 `createSkillByMcp`：
    - 校验 `title|name` 与 `description`。
    - 复用 `SkillService.createSkill` 完成落库。

- `backend/apps/agents/src/modules/tools/tool.module.ts`
  - 引入 `SkillModule`，保证 `ToolService` 可注入 `SkillService`。

### 2.2 测试

- `backend/apps/agents/src/modules/tools/tool.service.spec.ts`
  - 新增 skill-master 用例：
    - `list-skills` title 模糊检索映射
    - `create-skill` 成功创建
    - `create-skill` 缺失 description 报错

## 3. 文档同步

- `docs/plan/SKILL_MASTER_MCP_PLAN.md`
  - 记录需求计划与影响范围。

- `docs/features/AGENT_TOOL.md`
  - 增补 `skill-master` 工具能力说明。

- `docs/api/agents-api.md`
  - 增补 skill-master 两个 MCP 工具端点与参数约定。

## 4. 验证

- 执行：`npm test -- backend/apps/agents/src/modules/tools/tool.service.spec.ts`（backend）
- 结果：通过（6 passed）

- 执行：`npm run build:agents`（backend）
- 结果：构建通过

## 5. 风险与后续建议

- `title` 属于 MCP 调用语义，后端实体字段为 `name`，目前已通过映射统一；建议后续在调用文档中固定这一约定。
- 当前创建接口未做名称唯一性强约束（按现有 SkillService 规则执行）；若未来需要幂等创建，建议补充去重策略（如 name+provider+version）。
