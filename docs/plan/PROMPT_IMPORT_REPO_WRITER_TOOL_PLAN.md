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
- 目录结构 → 推导 category（engineering/design/marketing 等）
- 文件内容特征 → 判断是否为 Agent 角色 Prompt（包含 Identity、Mission、Deliverables 等段落）
- 文件名 → 推导 scene + role（如 `engineering-frontend-developer.md` → scene: engineering, role: frontend-developer）

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
  scene: string,                // 场景（如 'engineering'）
  role: string,                 // 角色（如 'frontend-developer'）
  content: string,              // Prompt 正文
  description?: string,         // 描述
  category?: string,            // 分类
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
    scene: string,
    role: string,
    content: string,
    description?: string,
    category?: string,
    tags?: string[],
    source?: { type: string, repo?: string, path?: string },
  }>,
  autoPublish?: boolean,
}
```

#### 行为逻辑

1. 校验必填字段（scene, role, content）
2. 检查 scene + role 是否已存在
   - 已存在：创建新版本草稿
   - 不存在：创建 version 1 草稿
3. 如果 `autoPublish = true`，自动发布
4. 批量模式下逐条处理，返回每条的处理结果
5. 返回 `{ success, totalProcessed, created, updated, failed, details: [...] }`

#### 权限

```typescript
requiredPermissions: [{ id: 'prompt_write', name: 'Prompt Registry Write', level: 'intermediate' }]
```

### 3.4 PromptTemplate Schema 扩展

在现有 `prompt-template.schema.ts` 上新增字段：

```typescript
// 新增字段
category?: string;              // 分类（engineering/design/marketing/sales 等）
tags?: string[];                // 标签数组
source?: {                      // 来源信息
  type: 'github' | 'manual' | 'internal';
  repo?: string;                // 仓库地址
  path?: string;                // 文件路径
  importedAt?: Date;            // 导入时间
};
```

**注意**：现有 `scene + role + version` 的唯一索引保持不变。新导入的 Prompt 使用新的 scene 值（如 `engineering`、`design`），不与现有系统 scene（`meeting`、`orchestration`）冲突。

---

## 4. 开发步骤

### Step 1: PromptTemplate Schema 扩展
- [ ] 在 `prompt-template.schema.ts` 新增 `category`、`tags`、`source` 字段
- **影响**: 数据库 Schema
- **风险**: 低（新增可选字段，不影响现有数据）

### Step 2: 新建 repo-writer Tool
- [ ] 在 `builtin-tool-catalog.ts` 注册 Tool 定义
- [ ] 在 `builtin-tool-definitions.ts` 添加 Tool ID 常量
- [ ] 在 `repo-tool-handler.service.ts` 实现 `executeRepoWriter()` 方法
- [ ] 在 `tool.service.ts` 的 `dispatchRepoToolImplementation()` 添加路由
- **影响**: 后端 Tool 模块
- **风险**: 中（涉及文件系统写操作，需要安全校验）

### Step 3: 新建 save-prompt-template Tool
- [ ] 在 `builtin-tool-catalog.ts` 注册 Tool 定义
- [ ] 在 `builtin-tool-definitions.ts` 添加 Tool ID 常量
- [ ] 新建 `prompt-registry-tool-handler.service.ts`
- [ ] 在 `tool.service.ts` 添加路由分发
- [ ] 在 `tool.module.ts` 注册新 Handler
- **影响**: 后端 Tool 模块 + Prompt Registry 模块
- **风险**: 低

### Step 4: 种子数据更新
- [ ] 运行 `seedBuiltinTools` 将新 Tool 注册到数据库
- **影响**: 数据库 Tool 集合

### Step 5: 验证测试
- [ ] 端到端测试：clone agency-agents 仓库 → repo-read 分析 → save-prompt-template 导入
- [ ] 安全测试：验证沙箱限制（尝试写入 data/ 外的目录应失败）
- [ ] 幂等测试：重复导入同一 Prompt，应创建新版本而非报错

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

## 6. 后续扩展（不在本次范围）

- [ ] Agent Schema 新增 `promptTemplateId` 字段，支持从 Prompt 库选择
- [ ] Skill Schema 新增 `promptTemplateId` 字段，支持绑定 Prompt
- [ ] 前端 PromptRegistry 页面展示 persona 类型 Prompt
- [ ] 前端 Agent 创建/编辑页增加"从 Prompt 库选择"
- [ ] 前端 Skill 创建/编辑页增加"绑定 Prompt"
- [ ] 运行时 buildMessages() 融入 PromptTemplate content
- [ ] repo-writer 扩展更多写操作（mkdir/write-file）
- [ ] 考虑是否将 docs-write 合并到 repo-writer

---

## 7. 风险与注意事项

1. **安全**：repo-writer 的目录沙箱限制是核心安全保障，必须严格校验路径不能逃逸出 `data/` 目录
2. **磁盘空间**：clone 大型仓库可能占用较多空间，建议使用 `--depth 1` 浅克隆
3. **Token 消耗**：Agent 用 repo-read 逐个读文件分析时，Token 消耗较大。如果仓库文件很多（agency-agents 有 100+ 个），建议 Agent 先读目录结构，批量 cat 同类文件
4. **scene + role 冲突**：导入的 Prompt 使用新的 scene 值，需确保不与现有系统 scene 冲突
5. **PromptTemplate 版本管理**：重复导入同一 Prompt 时，应创建新版本而非覆盖
