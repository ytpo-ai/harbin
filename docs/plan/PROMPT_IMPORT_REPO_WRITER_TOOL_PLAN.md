# Plan: Prompt 批量导入 & repo-writer 工具

> **任务类型**: plan  
> **创建时间**: 2026-03-22  
> **状态**: 开发完成  

---

## 1. 需求背景

希望将外部开源 AI Agent 角色库（如 [agency-agents](https://github.com/msitarzewski/agency-agents/)）中的 Prompt 批量导入到系统的 PromptTemplate 资源库中。导入后的 Prompt 可供 Agent 创建时选用，也可供 Skill 绑定使用。

**核心设计**：让 Agent 自身具备"分析外部 Git 仓库 + 识别可导入的 Prompt + 执行导入"的能力，通过 3 个 Tool 动作完成。

---

## 2. 总体架构

### 2.1 Tool 动作流程

```
Agent 工作流：

1. repo-writer (git-clone)
   → clone 远程仓库到 data/repos/{repo-name}/

2. repo-read (现有工具，无需改动)
   → Agent 用 ls/cat/find 读取 clone 后的文件
   → Agent 用 LLM 自行分析哪些文件是 Prompt（利用自身智能判断）

3. save-prompt-template (新建)
   → 将分析结果批量写入 PromptTemplate 表
```

### 2.2 工具对称设计

| 工具 | 权限 | 能力范围 | 安全边界 |
|------|------|---------|---------|
| `repo-read`（已有） | 只读 | cat/ls/grep/find/git log/show/diff | 白名单命令 |
| `repo-writer`（新建） | 写入 | git clone，未来可扩展 mkdir/write-file | **目录沙箱：仅允许 `data/` 目录下操作** |
| `docs-write`（已有） | 写入 | docs/ 目录下 .md 文件写入 | 保持独立，不合并 |

---

## 3. 详细设计

### 3.1 Tool 1：repo-writer

- **Tool ID**: `builtin.sys-mg.internal.rd-related.repo-writer`
- **归属 Toolkit**: `rd-related`（与 repo-read 同组）
- **归属 Handler**: `RepoToolHandler`（扩展 `repo-tool-handler.service.ts`）
- **类型**: `file_operation`
- **分类**: `Engineering Intelligence`

#### 参数定义

```typescript
{
  action: 'git-clone',          // 子命令，未来可扩展
  repoUrl: string,              // 远程仓库 HTTPS URL（必填）
  branch?: string,              // 分支名（可选，默认 main）
  targetDir?: string,           // 目标子目录名（可选，默认从 URL 推导）
}
```

#### 行为逻辑

1. 校验 `repoUrl` 为合法 HTTPS URL（禁止 SSH/file 协议）
2. 推导目标目录：`{workspaceRoot}/data/repos/{targetDir || repo-name}/`
3. 如果目标目录已存在且是 git 仓库，执行 `git pull` 更新；否则执行 `git clone`
4. clone 使用 `--depth 1`（浅克隆，节省空间和时间）
5. 返回 `{ success, localPath, repoUrl, branch, fileCount }`

#### 安全约束

- **目录沙箱**：写操作只允许在 `{workspaceRoot}/data/` 目录下
- **协议限制**：只允许 HTTPS URL
- **空间限制**：可配置最大仓库大小（环境变量）
- **超时**：clone 操作设置合理超时（默认 60s）
- **权限**：`requiredPermissions: [{ id: 'repo_write', name: 'Repository Write', level: 'intermediate' }]`

### 3.2 Tool 2：repo-read（现有，无需改动）

Agent clone 仓库到 `data/repos/{repo-name}/` 后，`repo-read` 的工作目录就是项目根目录，Agent 可以通过以下命令分析仓库：

```bash
# 列出目录结构
ls data/repos/agency-agents/

# 查看文件内容
cat data/repos/agency-agents/engineering/engineering-frontend-developer.md

# 批量查找 md 文件
find data/repos/agency-agents/ -name "*.md" -type f
```

**Agent 自行用 LLM 分析**：
- 目录结构 → 推导 domain（engineering/design/marketing 等）
- 文件内容特征 → 判断是否为 Agent 角色 Prompt（包含 Identity、Mission、Deliverables 等段落）
- 文件名 → 推导 role（如 `engineering-frontend-developer.md` → `category=recruitment, scene=technical, role=engineering:frontend-developer`）

### 3.3 Tool 3：save-prompt-template

- **Tool ID**: `builtin.sys-mg.mcp.prompt-registry.save-template`
- **归属 Toolkit**: `prompt-registry`（新建）
- **归属 Handler**: 新建 `PromptRegistryToolHandler`
- **类型**: `data_analysis`
- **分类**: `System Intelligence`

#### 参数定义

```typescript
{
  // 单条保存
  category: 'system' | 'recruitment',  // 顶层分类（必填）
  scene: string,                // 场景（recruitment 类固定 'technical'；system 类如 'meeting'/'agent-runtime'）
  role: string,                 // 角色（recruitment 类格式 '<domain>:<persona-role>'，如 'engineering:frontend-developer'）
  content: string,              // Prompt 正文
  description?: string,         // 描述
  tags?: string[],              // 标签
  source?: {                    // 来源信息
    type: 'github' | 'manual',
    repo?: string,              // 仓库地址
    path?: string,              // 文件路径
  },
  autoPublish?: boolean,        // 是否自动发布（默认 false，仅保存草稿）
}
```

或批量模式：

```typescript
{
  templates: Array<{
    category: 'system' | 'recruitment',
    scene: string,
    role: string,
    content: string,
    description?: string,
    tags?: string[],
    source?: { type: string, repo?: string, path?: string },
  }>,
  autoPublish?: boolean,
}
```

#### 校验规则

1. `category` 必填，仅允许 `system` 或 `recruitment`
2. 当 `category = recruitment` 时：
   - `role` 必须匹配 `/^[a-z0-9-]+:[a-z0-9-]+$/`（`<domain>:<persona-role>`）
   - 冒号前后均不能为空，非法值（如 `engineering:`、`:frontend-developer`）拒绝入库
3. 当 `category = system` 时：
   - `role` 保持现有自由格式，不做冒号约束

#### 行为逻辑

1. 校验必填字段（category, scene, role, content）
2. 按 category 执行 role 格式校验（见上方校验规则）
3. 检查 scene + role 是否已存在
   - 已存在：创建新版本草稿
   - 不存在：创建 version 1 草稿
4. 如果 `autoPublish = true`，自动发布
5. 批量模式下逐条处理，返回每条的处理结果
6. 返回 `{ success, totalProcessed, created, updated, failed, details: [...] }`

#### 权限

```typescript
requiredPermissions: [{ id: 'prompt_write', name: 'Prompt Registry Write', level: 'intermediate' }]
```

### 3.4 PromptTemplate Schema 现状（已具备，无需修改）

以下字段已在 `prompt-template.schema.ts` 中存在，**无需新增**：

| 字段 | 类型 | Schema 状态 | 说明 |
|---|---|---|---|
| `category` | `string` (optional) | **已存在** | 顶层分类，应用层限制为 `system` / `recruitment` |
| `tags` | `string[]` (optional) | **已存在** | 标签数组 |
| `source` | 嵌套子文档 (optional) | **已存在** | 含 `type`/`repo`/`path`/`importedAt` |

**设计决策**：
- `category` 在 Schema 层保持自由 string（不加 enum），**在 save-prompt-template handler 层做业务校验**，避免影响已有数据
- 现有唯一索引 `scene + role + version` 保持不变
- 招聘类 Prompt 使用 `scene=technical` + `role=<domain>:<persona-role>` 结构，不与现有系统 scene（`meeting`、`agent-runtime` 等）冲突

---

## 4. 开发步骤

### Step 1: PromptTemplate Schema 扩展 ~~已完成~~
- [x] `category`、`tags`、`source` 字段已存在于 Schema 中，无需改动

### Step 2: 新建 repo-writer Tool ~~已完成~~
- [x] `builtin-tool-catalog.ts` 已注册
- [x] `builtin-tool-definitions.ts` 已添加 `RD_REPO_WRITER_TOOL_ID`
- [x] `repo-tool-handler.service.ts` 已实现 `executeRepoWriter()`
- [x] `tool.service.ts` 的 `dispatchRepoToolImplementation()` 已路由

### Step 3: 新建 save-prompt-template Tool ~~已完成~~
- [x] `builtin-tool-catalog.ts` 已注册
- [x] `builtin-tool-definitions.ts` 已添加 `PROMPT_REGISTRY_SAVE_TEMPLATE_TOOL_ID`
- [x] `prompt-registry-tool-handler.service.ts` 已创建
- [x] `tool.service.ts` 已添加 `dispatchPromptRegistryToolImplementation()` 路由
- [x] `tool.module.ts` 已注册 `PromptRegistryToolHandler`

### Step 4: 种子数据更新 ~~已完成~~
- [x] `seedBuiltinTools` 已包含新 Tool

### Step 5: 验证测试（待执行）
- [ ] 端到端测试：clone agency-agents 仓库 → repo-read 分析 → save-prompt-template 导入
- [ ] 安全测试：验证沙箱限制（尝试写入 data/ 外的目录应失败）
- [ ] 幂等测试：重复导入同一 Prompt，应创建新版本而非报错

### Step 6: save-prompt-template 增强校验（待开发）
- [x] handler 层增加 `category` 必填校验，仅允许 `system` / `recruitment`
- [x] 当 `category=recruitment` 时，校验 `role` 格式必须匹配 `/^[a-z0-9-]+:[a-z0-9-]+$/`
- [x] 当 `category=system` 时，`role` 保持自由格式

---

## 5. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/apps/agents/src/schemas/prompt-template.schema.ts` | 修改 | 新增 category/tags/source 字段 |
| `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts` | 修改 | 注册 2 个新 Tool 定义 |
| `backend/apps/agents/src/modules/tools/builtin-tool-definitions.ts` | 修改 | 新增 Tool ID 常量 |
| `backend/apps/agents/src/modules/tools/repo-tool-handler.service.ts` | 修改 | 新增 executeRepoWriter() |
| `backend/apps/agents/src/modules/tools/prompt-registry-tool-handler.service.ts` | **新建** | save-prompt-template 处理器 |
| `backend/apps/agents/src/modules/tools/tool.service.ts` | 修改 | 新增路由分发 |
| `backend/apps/agents/src/modules/tools/tool.module.ts` | 修改 | 注册新 Handler |
| `backend/apps/agents/src/modules/prompt-registry/prompt-registry-admin.service.ts` | 可能修改 | 支持批量导入 |

---

## 6. 后续扩展

### 已纳入第 9 节落地计划（Skill/Agent 绑定 Prompt）
- [x] Agent Schema 新增 `promptTemplateRef: { scene, role }`，支持从 Prompt 库选择
- [x] Skill Schema 新增 `promptTemplateRef: { scene, role }`，支持绑定 Prompt
- [x] 运行时 Identity Layer 注入 Agent 绑定 Prompt（追加到 systemPrompt 之后）
- [x] 运行时 Toolset Layer 注入 Skill 绑定 Prompt（替换 skill.content）
- [ ] Prompt Read 工具：list-templates + get-template（详见 9.6 节）
- [ ] 前端 Agent 创建/编辑页增加"从 Prompt 库选择"（详见 9.7 节）
- [ ] 前端 Skill 创建/编辑页增加"绑定 Prompt"（详见 9.8 节）
- [x] Prompt 管理页 category 标签页 + 创建时 category 选择（详见 9.10 节）

### 未纳入本次范围
- [ ] repo-writer 扩展更多写操作（mkdir/write-file）
- [ ] 考虑是否将 docs-write 合并到 repo-writer

---

## 7. 风险与注意事项

1. **安全**：repo-writer 的目录沙箱限制是核心安全保障，必须严格校验路径不能逃逸出 `data/` 目录
2. **磁盘空间**：clone 大型仓库可能占用较多空间，建议使用 `--depth 1` 浅克隆
3. **Token 消耗**：Agent 用 repo-read 逐个读文件分析时，Token 消耗较大。如果仓库文件很多（agency-agents 有 100+ 个），建议 Agent 先读目录结构，批量 cat 同类文件
4. **scene + role 冲突**：导入的 Prompt 使用新的 scene 值，需确保不与现有系统 scene 冲突
5. **PromptTemplate 版本管理**：重复导入同一 Prompt 时，应创建新版本而非覆盖

---

## 8. Prompt 设计二次结论（2026-03-23）

基于本次讨论，Prompt 分类与命名规范收敛为以下模型：

### 8.1 顶层分类（category）

- `system`：系统内部 Prompt（会议/计划/Agent 基础规则等）
- `recruitment`：招聘类 Prompt（来自 agency-agents 的导入内容全部归类到该类）

### 8.2 招聘类统一约定

招聘类 Prompt 统一使用以下结构：

```text
category = recruitment
scene = technical
role = <domain>:<persona-role>
```

示例：

```text
category = recruitment
scene = technical
role = engineering:frontend-developer
```

### 8.3 role 格式约束

- `role` 必须使用小写 kebab-case + 冒号分段
- 固定格式：`<domain>:<persona-role>`
- `domain` 与 `persona-role` 均不能为空
- 非法值（如 `engineering:`、`:frontend-developer`）应在导入/保存时拒绝

### 8.4 与现有 Schema 的关系

- 不新增 `domain` 独立字段
- 继续复用现有唯一索引：`scene + role + version`
- 通过 `role` 前缀实现招聘子域筛选（如 `engineering:`、`design:`、`marketing:`）

---

## 9. 后续落地计划（Skill/Agent 绑定 Prompt）

### 9.1 设计原则

#### 9.1.1 引用方式：使用 `{ scene, role }` 而非 ObjectId

PromptTemplate 的核心定位键是 `scene + role`，版本由 `PromptResolverService` 自动取最新 published。因此 Skill/Agent 绑定 Prompt 时，引用方式统一使用 `{ scene: string, role: string }` 组合，而非 ObjectId。

理由：
- 与现有 `PromptResolverService.resolve({ scene, role })` 解析链路天然一致
- Skill 体系内部全部使用 string ID（`Agent.skills: string[]` → `Skill.id: string`），不引入 ObjectId 风格差异
- 版本自动解析，绑定时不需要关心具体版本号

#### 9.1.2 注入层独立：Agent 与 Skill 解决不同层面问题

当前运行时 `ContextAssembler` 按 6 层 Builder 顺序组装 messages：

```
1. Identity Layer   → Agent persona（agent.systemPrompt）
2. Toolset Layer    → Skill 方法论（skill.content）+ 工具规格
3. Domain Layer     → 业务领域上下文
4. Collaboration    → 协作上下文
5. Task Layer       → 任务信息
6. Memory Layer     → 记忆
```

Agent 绑定 Prompt 注入 **Identity Layer**（作为 persona 人设），Skill 绑定 Prompt 注入 **Toolset Layer**（作为方法论指南）。两者职责不同，**不存在互斥关系，不需要跨层优先级**。

### 9.2 Skill 绑定 Prompt

#### Schema 变更

在 `agent-skill.schema.ts` 新增可选字段：

```typescript
@Prop({ type: Object, required: false })
promptTemplateRef?: {
  scene: string;    // 对应 PromptTemplate.scene
  role: string;     // 对应 PromptTemplate.role
};
```

#### 运行时行为

- 注入位置：**Toolset Layer**（`toolset-context.builder.ts`），与当前 `skill.content` 注入位置相同
- 解析策略：运行时调用 `PromptResolverService.resolve({ scene, role })` 获取最新 published 版本 content
- **替换语义**：若 `skill.promptTemplateRef` 存在且解析成功，**替换** `skill.content` 注入；解析失败时**回退**到 `skill.content`
- 不做追加，避免同时注入两份内容导致 token 浪费和语义冲突

#### 开发任务

- [x] `agent-skill.schema.ts` 新增 `promptTemplateRef?: { scene: string, role: string }`
- [x] Skill 创建/编辑 API 支持设置和清除 `promptTemplateRef`
- [x] `toolset-context.builder.ts` 或 `buildMessages()` 中 skill content 加载逻辑增加 PromptTemplate 解析分支
- [x] 回归测试：无 `promptTemplateRef` 的 Skill 行为不变

### 9.3 Agent 绑定 Prompt

#### 现有 Prompt 来源梳理

Agent 当前已有 3 个 prompt 相关来源：

| 来源 | 位置 | 说明 |
|---|---|---|
| `agent.systemPrompt` | Agent Schema 必填字段 | Agent 核心人设指令，注入 Identity Layer |
| `AgentRole.promptTemplate` | AgentRole Schema 可选字段 | 角色级别默认 prompt（纯文本，非 ObjectId 引用） |
| `AGENT_PROMPTS.agentWorkingGuideline` | 代码内置 + PromptTemplate DB | 通用工作准则，通过 PromptResolverService 解析 |

#### Schema 变更

在 `agent.schema.ts` 新增可选字段：

```typescript
@Prop({ type: Object, required: false })
promptTemplateRef?: {
  scene: string;    // 对应 PromptTemplate.scene
  role: string;     // 对应 PromptTemplate.role
};
```

#### 语义边界

- `agent.systemPrompt`：**保持必填不动**，作为 Agent 的基础人设指令（创建时必须提供）
- `agent.promptTemplateRef`：**可选增强**，绑定后其 content **追加到** `systemPrompt` 之后注入 Identity Layer（作为补充 persona 知识，如招聘类的职位画像、技术栈要求等）
- `AgentRole.promptTemplate`：角色级别默认值，优先级最低

#### 运行时行为

Identity Layer 注入顺序（`identity-context.builder.ts`）：

```
1. agentWorkingGuideline（通用工作准则）
2. agent.systemPrompt（Agent 基础人设 — 保持不变）
3. agent.promptTemplateRef → resolve → content（PromptTemplate 补充 persona — 新增）
4. identityMemos（身份备忘录）
```

解析策略：调用 `PromptResolverService.resolve({ scene, role })` 获取最新 published 版本。解析失败时静默跳过（不影响原有 systemPrompt 注入）。

#### 开发任务

- [x] `agent.schema.ts` 新增 `promptTemplateRef?: { scene: string, role: string }`
- [x] Agent 创建/编辑 API 支持设置和清除 `promptTemplateRef`
- [x] `identity-context.builder.ts` 在 `systemPrompt` 之后新增 PromptTemplate content 注入逻辑
- [x] 回归测试：无 `promptTemplateRef` 的 Agent 行为不变

### 9.4 导入映射规则

- [ ] agency-agents 导入时默认映射到 `category=recruitment`
- [ ] 默认 `scene=technical`
- [ ] 按目录或文件名前缀推导 `domain`，编码进 `role=<domain>:<persona-role>`
- [ ] 冲突时按版本递增，不覆盖历史版本

### 9.5 验证项

- [ ] 招聘 Prompt 可按 `category=recruitment` 正确筛选
- [ ] 可按 `role` 前缀筛选 domain（如 `engineering:`）
- [ ] Skill 绑定 Prompt 后，Toolset Layer 正确替换 skill.content
- [ ] Skill 无绑定或解析失败时，回退到 skill.content
- [ ] Agent 绑定 Prompt 后，Identity Layer 在 systemPrompt 之后正确追加
- [ ] Agent 无绑定或解析失败时，原有 systemPrompt 注入不受影响
- [ ] 回归验证 system 类 Prompt 不受影响

### 9.6 Prompt Read 工具（list-templates + get-template）

#### 背景

当前 Agent 只有 `save-template` 工具（写入），缺少查询能力。Agent 需要在"绑定 Prompt 前先了解有哪些可用 Prompt"，或在工作流中根据场景动态检索合适的 Prompt 模板。

#### 工具拆分方案：list + detail 两个工具

**理由**：
- **职责单一**：`list` 返回轻量摘要（scene/role/category/status/description），`detail` 返回完整 content，避免一次性把所有 Prompt 全文拉回导致 token 浪费
- **Agent 决策链路清晰**：Agent 先 `list` 筛选 → 再 `detail` 读取具体内容，符合"浏览 → 聚焦"自然决策模式
- **与现有工具风格一致**：项目中 `agents.list` / `agents.detail` 已采用拆分模式

#### Tool 1: list-templates

| 属性 | 值 |
|---|---|
| **Tool ID** | `builtin.sys-mg.mcp.prompt-registry.list-templates` |
| **归属 Toolkit** | `prompt-registry` |
| **类型** | `data_analysis` |
| **权限** | `{ id: 'prompt_read', name: 'Prompt Registry Read', level: 'basic' }` |

**入参（parameters）**：

```typescript
{
  scene?: string;       // 按 scene 筛选（如 'technical', 'meeting', 'agent-runtime'）
  role?: string;        // 按 role 筛选或前缀匹配（如 'engineering:frontend-developer'）
  category?: string;    // 按 category 筛选（'system' | 'recruitment'）
  status?: string;      // 按版本状态筛选（'draft' | 'published' | 'archived'），默认 'published'
  limit?: number;       // 返回数量上限，默认 50
}
```

**返回结构**：

```typescript
{
  total: number;
  templates: Array<{
    scene: string;
    role: string;
    version: number;
    status: string;
    category?: string;
    description?: string;
    updatedAt: string;
  }>;  // 不含 content，节省 token
}
```

**实现复用**：直接委托 `PromptRegistryAdminService.listTemplates(query)`，在 handler 层做字段裁剪（去掉 `content`）。

#### Tool 2: get-template

| 属性 | 值 |
|---|---|
| **Tool ID** | `builtin.sys-mg.mcp.prompt-registry.get-template` |
| **归属 Toolkit** | `prompt-registry` |
| **类型** | `data_analysis` |
| **权限** | `{ id: 'prompt_read', name: 'Prompt Registry Read', level: 'basic' }` |

**入参（parameters）**：

```typescript
{
  // 方式一：通过 scene + role 查询最新 published 版本（推荐）
  scene?: string;
  role?: string;
  // 方式二：通过 templateId 直接查询
  templateId?: string;
}
```

**返回结构**：

```typescript
{
  _id: string;
  scene: string;
  role: string;
  version: number;
  status: string;
  category?: string;
  description?: string;
  content: string;       // 完整 Prompt 正文
  tags?: string[];
  source?: { type: string; url?: string };
  updatedAt: string;
}
```

**实现逻辑**：
- 若提供 `scene + role`：调用 `PromptRegistryAdminService.getEffectiveTemplate({ scene, role })` 获取最新 published 版本
- 若提供 `templateId`：调用 `PromptRegistryAdminService.getTemplateById(templateId)`
- 二者都未提供时返回参数错误

#### 开发任务

| # | 任务 | 涉及文件 |
|---|---|---|
| 1 | 新增 Tool ID 常量 | `builtin-tool-definitions.ts` |
| 2 | 在 `BUILTIN_TOOLS` 注册两个工具定义 | `builtin-tool-catalog.ts` |
| 3 | Handler 新增 `listPromptTemplates()` + `getPromptTemplate()` | `prompt-registry-tool-handler.service.ts` |
| 4 | Dispatch switch 新增两个 case | `tool.service.ts` |
| 5 | 无需改动（Handler 和 Module 已注册） | `tool.module.ts` |

### 9.7 前端 Agent 创建/编辑页增加"从 Prompt 库选择"

#### 现状分析

- **Agent 创建页**（`CreateAgentModal`）：`systemPrompt` 为 `<textarea>` 手动输入，选择 Role 时会自动填充 `role.promptTemplate` 默认文案
- **Agent 编辑页**（`EditAgentModal`，基础信息 Tab）：`systemPrompt` 同样为 `<textarea>` 手动输入
- **前端类型**：`Agent` 接口尚无 `promptTemplateRef` 字段
- **后端**：`agent.schema.ts` 已有 `promptTemplateRef?: { scene, role }` 字段，API 已支持读写
- **前端服务**：`promptRegistryService.ts` 已有 `listTemplates()` 和 `listTemplateFilters()` 方法可复用

#### 交互设计

**位置**：在 `systemPrompt` 输入框上方，新增一行"Prompt 模板引用"区域。

**创建页 & 编辑页（基础信息 Tab）统一交互**：

```
┌─ Prompt 模板（可选） ─────────────────────────────────┐
│                                                       │
│  [scene 下拉] [role 下拉]  [预览] [清除]               │
│                                                       │
│  已绑定: technical / engineering:frontend-developer    │
│  (运行时将追加到 systemPrompt 之后注入 Identity Layer)  │
└───────────────────────────────────────────────────────┘

┌─ System Prompt（必填）────────────────────────────────┐
│  <textarea>  ...                                      │
└───────────────────────────────────────────────────────┘
```

**交互流程**：

1. **scene 下拉**：调用 `promptRegistryService.listTemplateFilters()` 获取可选 scene 列表
2. **role 下拉**：根据选中 scene 联动筛选（使用 `sceneRoleMap[scene]`）
3. **预览按钮**：调用 `promptRegistryService.getTemplateById()` 或 `listTemplates({ scene, role, status: 'published' })` 获取 content，在弹窗/展开区域中只读展示
4. **清除按钮**：清空 `promptTemplateRef`，回到纯手动输入模式
5. **保存时**：将 `promptTemplateRef: { scene, role }` 随表单一起提交到 Agent 创建/更新 API

**语义说明**（需在 UI 中以灰色提示文字呈现）：
- `systemPrompt` 为 Agent 基础人设指令（**必填**，保持不变）
- `promptTemplateRef` 为可选增强，绑定后其 content **追加到 systemPrompt 之后**注入 Identity Layer
- 解析失败时静默跳过，不影响 systemPrompt

#### 前端类型扩展

```typescript
// types/index.ts — Agent 接口
export interface Agent {
  // ... existing fields
  promptTemplateRef?: {
    scene: string;
    role: string;
  };
}
```

#### 开发任务

| # | 任务 | 涉及文件 |
|---|---|---|
| 1 | `Agent` 类型新增 `promptTemplateRef` 字段 | `frontend/src/types/index.ts` |
| 2 | `CreateAgentModal` 新增 Prompt 模板选择区域（scene/role 下拉 + 预览 + 清除） | `frontend/src/pages/Agents.tsx` |
| 3 | `EditAgentModal` 基础信息 Tab 新增同样的 Prompt 模板选择区域 | `frontend/src/pages/Agents.tsx` |
| 4 | 创建/编辑 API 调用时透传 `promptTemplateRef` 字段 | `frontend/src/pages/Agents.tsx` |
| 5 | Agent 编辑页回显已绑定的 `promptTemplateRef`（从 agent 数据中读取并设为下拉默认值） | `frontend/src/pages/Agents.tsx` |

### 9.8 前端 Skill 创建/编辑页增加"绑定 Prompt"

#### 现状分析

- **Skill 创建弹窗**（`SkillFormModal`）：不包含 `content` 字段，仅填写元信息
- **Skill 编辑抽屉**（`SkillDetailDrawer`，详情 Tab）：`content` 为 `<textarea>` 手动输入，8 行，标签 "content"，placeholder "Markdown 正文"
- **前端类型**：`Skill` 接口尚无 `promptTemplateRef` 字段
- **后端**：`agent-skill.schema.ts` 已有 `promptTemplateRef?: { scene, role }` 字段，API 已支持读写
- **运行时语义**：若 `skill.promptTemplateRef` 存在且解析成功，**替换** `skill.content` 注入 Toolset Layer；解析失败时回退到 `skill.content`

#### 交互设计

**位置**：在 `SkillDetailDrawer` 详情 Tab 的 `content` 输入框上方，新增一行"Prompt 模板绑定"区域。

**编辑抽屉交互**：

```
┌─ Prompt 模板绑定（可选） ─────────────────────────────┐
│                                                       │
│  [scene 下拉] [role 下拉]  [预览] [清除]               │
│                                                       │
│  已绑定: meeting / facilitator                         │
│  (运行时将替换下方 content 注入 Toolset Layer)          │
└───────────────────────────────────────────────────────┘

┌─ Content（Markdown 正文）────────────────────────────┐
│  <textarea>  ...                                      │
│  (当已绑定 Prompt 模板时，此字段作为 fallback 备用)     │
└───────────────────────────────────────────────────────┘
```

**交互流程**：

1. **scene 下拉** / **role 下拉**：与 Agent 页面复用相同的 `listTemplateFilters()` 数据源
2. **预览按钮**：弹窗展示选中模板的完整 content
3. **清除按钮**：清空 `promptTemplateRef`，运行时将回退使用 `content` 字段
4. **视觉提示**：当 `promptTemplateRef` 已设置时，`content` 输入框显示半透明样式 + 提示"已绑定 Prompt 模板，此内容作为 fallback"
5. **保存时**：将 `promptTemplateRef: { scene, role }` 随 Skill 更新 API 一起提交

**创建弹窗**（`SkillFormModal`）：
- 当前创建弹窗不含 `content` 字段，**暂不在创建弹窗中加入 Prompt 绑定**
- 用户在创建后进入编辑抽屉再绑定（保持创建流程简洁）

#### 前端类型扩展

```typescript
// types/index.ts — Skill 接口
export interface Skill {
  // ... existing fields
  promptTemplateRef?: {
    scene: string;
    role: string;
  };
}
```

#### 开发任务

| # | 任务 | 涉及文件 |
|---|---|---|
| 1 | `Skill` 类型新增 `promptTemplateRef` 字段 | `frontend/src/types/index.ts` |
| 2 | 提取 `PromptTemplateRefPicker` 通用组件（scene/role 联动下拉 + 预览 + 清除） | `frontend/src/components/PromptTemplateRefPicker.tsx`（新建） |
| 3 | `SkillDetailDrawer` 详情 Tab 接入 `PromptTemplateRefPicker`，置于 content 上方 | `frontend/src/pages/Skills.tsx` |
| 4 | `content` 输入框在已绑定时增加视觉提示（半透明 + fallback 说明） | `frontend/src/pages/Skills.tsx` |
| 5 | Skill 更新 API 调用时透传 `promptTemplateRef` 字段 | `frontend/src/pages/Skills.tsx` |
| 6 | Skill 编辑抽屉回显已绑定的 `promptTemplateRef` | `frontend/src/pages/Skills.tsx` |
| 7 | Agent 创建/编辑页复用 `PromptTemplateRefPicker` 组件 | `frontend/src/pages/Agents.tsx` |

### 9.9 验证项（补充）

- [ ] Agent 可通过 `list-templates` 工具查询 Prompt 列表（按 scene/role/category 筛选正常）
- [ ] Agent 可通过 `get-template` 工具获取 Prompt 完整内容（scene+role 和 templateId 两种方式均正常）
- [ ] `list-templates` 返回不含 content 字段，`get-template` 返回含 content 字段
- [ ] 前端 Agent 创建页可选择 Prompt 模板并正确保存 `promptTemplateRef`
- [ ] 前端 Agent 编辑页可回显、修改、清除已绑定的 `promptTemplateRef`
- [ ] 前端 Skill 编辑抽屉可绑定 Prompt 模板并正确保存 `promptTemplateRef`
- [ ] Skill 绑定 Prompt 后 content 输入框显示 fallback 视觉提示
- [ ] 清除绑定后运行时回退到 `skill.content` / `agent.systemPrompt`

### 9.10 Prompt 管理页 category 标签页 + 创建时 category 选择

#### 背景

当前 Prompt 管理页（`PromptRegistry.tsx`）为单一扁平列表，所有 category 的模板混在一起。随着 `recruitment` 类 Prompt 的引入，需要按 category 分标签页浏览，并在创建时明确指定 category。

#### 现状差距

| 能力 | Schema | 后端 Service | 后端 Controller | 前端 Service | 前端 UI |
|---|---|---|---|---|---|
| `category` 字段存在 | YES | YES（saveDraft 写入） | YES（saveDraft 接收） | NO | NO |
| `category` 列表过滤 | - | NO | NO（无 query param） | NO | NO |
| `category` 在 filters 返回 | - | NO（不聚合） | NO | NO | NO |
| `category` 在 PromptTemplateItem | - | YES（lean 返回） | YES | NO（类型缺失） | NO（不渲染） |
| 标签页导航 | - | - | - | - | NO（扁平页面） |

#### 9.10.1 后端改动

**文件：`prompt-registry-admin.service.ts`**

1. **`listTemplates(query)` 增加 `category` 过滤**：
   ```typescript
   // query 新增 category?: string
   if (query.category) {
     filter.category = query.category;
   }
   ```

2. **`listTemplateFilters()` 返回 categories**：
   ```typescript
   // 聚合 distinct category
   const categories = await this.model.distinct('category').exec();
   return { scenes, roles, statuses, categories, sceneRoleMap };
   ```

**文件：`prompt-registry.controller.ts`**

3. **`GET /templates` 增加 `@Query('category') category` 参数**，透传给 service。

4. **`GET /templates/filters` 返回值自动包含 `categories`**（service 层改动后自动生效）。

#### 9.10.2 前端服务层改动

**文件：`promptRegistryService.ts`**

1. **`PromptTemplateItem` 类型新增**：
   ```typescript
   category?: string;
   ```

2. **`PromptTemplateFilterOptions` 类型新增**：
   ```typescript
   categories: string[];
   ```

3. **`listTemplates` 方法 params 新增 `category?: string`**，透传到请求 query。

4. **`saveDraft` 方法 payload 新增 `category?: string`**，透传到请求 body。

#### 9.10.3 前端 UI 改动

**文件：`PromptRegistry.tsx`**

##### A. 顶部 category 标签页

在 header 区域（"Prompt 管理"标题下方）新增标签栏：

```
┌───────────────────────────────────────────────────────┐
│  Prompt 管理                                  [新增]   │
│                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │  全部    │ │  system  │ │recruitment│ ...动态生成   │
│  └──────────┘ └──────────┘ └──────────┘              │
│                                                       │
│  [scene ▾]  [role ▾]  [status ▾]  [刷新]              │
└───────────────────────────────────────────────────────┘
```

- **"全部"标签**：不过滤 category（与当前行为一致）
- **动态标签**：从 `listTemplateFilters().categories` 获取，每个 category 一个 Tab
- 切换标签时 `listTemplates({ ..., category })` 带上过滤参数
- Tab 样式复用项目中已有的 border-bottom 风格（如 `EditAgentModal` 的 tab 样式）

**状态新增**：
```typescript
const [categoryTab, setCategoryTab] = useState<string>(''); // '' = 全部
```

**查询联动**：
```typescript
useQuery(
  ['prompt-templates', categoryTab, scene, role, statusFilter],
  () => listTemplates({ category: categoryTab || undefined, scene, role, status, limit: 200 }),
  { enabled: !!scene && !!role }
);
```

##### B. 创建弹窗新增 category 选择

在创建/复制弹窗的 `scene` 输入框上方新增 category 下拉：

```
┌─ 新增 Prompt ──────────────────────────────┐
│                                             │
│  Category（分类）*                           │
│  [system ▾]                                 │
│                                             │
│  Scene（场景）*                              │
│  [________]                                 │
│                                             │
│  Role（角色）*                               │
│  [________]                                 │
│  ...                                        │
└─────────────────────────────────────────────┘
```

- **下拉选项**：固定 `system`（默认）和 `recruitment`；后续新增 category 时通过 filters 动态获取
- **默认值**：`system`
- **必填**：是（创建时必须选择 category）
- **复制模式**：从被复制模板继承 category 值

**状态新增**：
```typescript
const [createCategory, setCreateCategory] = useState<string>('system');
```

**提交时**：
```typescript
await saveDraft({
  category: createCategory,  // 新增
  scene: createScene,
  role: createRole,
  content: createContent,
  description: createDescription,
  summary: createSummary,
});
```

##### C. 版本卡片显示 category 标签

在每个模板卡片的 version badge 旁边新增一个 category 标签：

```
┌────────────────────────────────────────────┐
│  v3  [published] [system]  2026-03-22      │
│  Description text...                       │
│                          [编辑][删除]...    │
└────────────────────────────────────────────┘
```

- 样式：与 status 标签类似的小 badge，颜色区分（如 `system` = blue，`recruitment` = purple）

#### 开发任务

| # | 任务 | 涉及文件 |
|---|---|---|
| 1 | `listTemplates` service 增加 `category` 过滤 | `prompt-registry-admin.service.ts` |
| 2 | `listTemplateFilters` 返回 `categories` | `prompt-registry-admin.service.ts` |
| 3 | `GET /templates` 增加 `category` query param | `prompt-registry.controller.ts` |
| 4 | 前端 `PromptTemplateItem` 类型新增 `category` | `promptRegistryService.ts` |
| 5 | 前端 `PromptTemplateFilterOptions` 新增 `categories` | `promptRegistryService.ts` |
| 6 | 前端 `listTemplates` / `saveDraft` params 新增 `category` | `promptRegistryService.ts` |
| 7 | 页面顶部新增 category 标签栏 + 查询联动 | `PromptRegistry.tsx` |
| 8 | 创建/复制弹窗新增 category 下拉（默认 system） | `PromptRegistry.tsx` |
| 9 | 版本卡片显示 category badge | `PromptRegistry.tsx` |
| 10 | `category` 字段加 MongoDB 索引（可选，数据量大时补） | `prompt-template.schema.ts` |

#### 验证项

- [ ] 切换 category 标签后列表正确过滤，"全部"不过滤
- [ ] category 标签从 `listTemplateFilters().categories` 动态生成
- [ ] 创建弹窗 category 默认 `system`，提交后正确写入
- [ ] 复制弹窗继承源模板 category
- [ ] 版本卡片正确显示 category badge
- [ ] 已有无 category 的历史数据在"全部"标签下正常展示

---

## 10. 方案审计记录（2026-03-23）

### 10.1 审计范围

对 plan 全文进行代码交叉验证，覆盖：PromptTemplate Schema、Skill Schema、Agent Schema、Tool 注册体系（catalog/definitions/handler/dispatch/module）、运行时 buildMessages + ContextAssembler 6 层 Builder 架构。

### 10.2 审计发现与处置

| # | 问题 | 严重程度 | 处置方式 |
|---|---|---|---|
| 1 | `category` Schema 无 enum 约束 | 低 | handler 层校验，不改 Schema（已更新 3.3 节 + Step 6） |
| 2 | `role` 格式（`<domain>:<persona-role>`）无校验 | 中 | handler 层按 category 分别校验（已更新 3.3 节 + Step 6） |
| 3 | 3.3 节示例与 8.2 节约定矛盾（scene 写了 `engineering`） | 低 | 已统一为 `scene=technical, role=engineering:frontend-developer`（已修复 3.3 节） |
| 4 | Agent 三个 prompt 来源语义边界未定义 | **高** | 已明确：`systemPrompt` 保持必填基础人设，`promptTemplateRef` 可选追加补充 persona（已重写 9.3 节） |
| 5 | Skill 绑定 prompt 注入行为未定义（替换 vs 追加） | **高** | 已明确：**替换** `skill.content`，失败回退（已重写 9.2 节） |
| 6 | `promptTemplateId` 用 ObjectId 与 Skill 体系 string ID 风格不一致 | 中 | 已改为 `promptTemplateRef: { scene, role }`（已重写 9.2 / 9.3 节） |
| 7 | 运行时优先级 `Agent > Skill > 默认` 定义不精确（跨层问题） | 中 | 已改为"各层独立绑定，不设跨层优先级"（已重写 9.1.2 节） |

### 10.3 Step 1-4 代码验证结论

Step 1-4 标注"开发完成"，代码验证确认**全部已落地**：
- `prompt-template.schema.ts`：`category`/`tags`/`source` 字段均已存在
- `builtin-tool-definitions.ts`：`RD_REPO_WRITER_TOOL_ID` / `PROMPT_REGISTRY_SAVE_TEMPLATE_TOOL_ID` 已定义
- `builtin-tool-catalog.ts`：两个 Tool 已在 `BUILTIN_TOOLS` 数组中注册
- `repo-tool-handler.service.ts`：`executeRepoWriter()` 已实现
- `prompt-registry-tool-handler.service.ts`：`savePromptTemplate()` 已实现
- `tool.service.ts`：`dispatchRepoToolImplementation` / `dispatchPromptRegistryToolImplementation` 已路由
- `tool.module.ts`：`RepoToolHandler` / `PromptRegistryToolHandler` 已注册 providers + exports
