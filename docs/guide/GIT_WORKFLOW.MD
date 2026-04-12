# Git 工作流规范

本文档定义项目的 Git 分支策略、Worktree 隔离开发流程、分支收尾规范和安全红线。

Commit Message 格式和提交前检查清单见 `AGENTS.md` 的 Git Commit 协议部分，本文档不重复。

---

## 1. 分支策略

### 1.1 主分支保护

- `main`（或 `master`）是唯一的长期分支，始终保持可部署状态
- **禁止在 main 上直接开发**，除非用户明确要求
- 所有功能开发、修复均在 feature branch 上进行

### 1.2 Feature Branch 命名规范

```
<type>/<module>-<brief-description>
```

| 字段 | 说明 | 示例 |
|------|------|------|
| `type` | 分支类型 | `feat` / `fix` / `refactor` / `docs` / `chore` |
| `module` | 所属模块（与 feature 文档对齐） | `agent-skill` / `orchestration` / `meeting` |
| `brief-description` | 2-4 个词的简述，kebab-case | `batch-import` / `sse-push-optimize` |

### 示例

```
feat/agent-skill-batch-import
fix/orchestration-sse-timeout
refactor/meeting-context-split
docs/requirement-template-update
```

### 1.3 分支与 Requirement 的对应

- 1 个 requirement = 1 个 feature branch = 1 次 develop + review 周期
- 分支名中的 `<module>-<brief>` 应与 requirement 文件名的 `<MODULE>_REQ-<NNN>_<BRIEF>` 保持语义对齐
- 分支创建后，在 requirement 文档的基本信息表中记录分支名

---

## 2. Git Worktree 隔离开发

### 2.1 为什么用 Worktree

在 AI 辅助开发中，plan session 和 develop session 使用不同模型，需要物理隔离：

- **Plan Session**（主工作目录）：讨论设计、输出 plan/requirement、执行 code review
- **Develop Session**（worktree）：在隔离目录中执行开发，不干扰主工作目录的状态

### 2.2 Worktree 目录约定

首选位置：项目根目录下的 `.worktrees/`

```
<project-root>/
  ├── .worktrees/          ← worktree 存放目录（必须被 gitignore）
  │   ├── feat-agent-skill-batch-import/
  │   └── fix-orchestration-sse-timeout/
  └── ...（主工作目录）
```

### 2.3 安全前置检查

创建 worktree **之前**，必须验证 `.worktrees/` 已被 gitignore：

```bash
# 验证目录被 gitignore
git check-ignore .worktrees/

# 如果没有输出（未被忽略），先添加到 .gitignore
echo ".worktrees/" >> .gitignore
git add .gitignore && git commit -m "chore: add .worktrees to gitignore"
```

**铁律：不得在未被 gitignore 的目录中创建 worktree，否则会污染 git status。**

### 2.4 Worktree 创建流程

```bash
# 1. 确认在项目根目录
cd "$(git rev-parse --show-toplevel)"

# 2. 创建 worktree + feature branch
BRANCH="feat/agent-skill-batch-import"
git worktree add ".worktrees/${BRANCH##*/}" -b "$BRANCH"

# 3. 进入 worktree 安装依赖
cd ".worktrees/${BRANCH##*/}"
# Node.js 项目
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
pnpm install

# 4. 运行测试验证基线
pnpm test  # 或对应测试命令
```

如果基线测试不通过，报告失败并询问用户是否继续，**不自行决定**。

### 2.5 Worktree 使用规则

| 规则 | 说明 |
|------|------|
| 一个 worktree 对应一个 feature branch | 不在同一个 worktree 中混合多个功能 |
| develop session 在 worktree 中执行 | 所有代码修改、commit 都在 worktree 目录中 |
| review session 可在主目录或 worktree 中 | review 时通过 `git diff` 或 `git log` 查看变更 |
| worktree 中不执行 merge | merge 操作回到主工作目录执行 |

---

## 3. 分支收尾流程

当 develop + review 完成后，按以下标准化流程收尾：

### 3.1 四个选项（固定不变）

完成 requirement 的开发和 review 后，向用户提供以下选项：

1. **Merge 到主分支** — 本地 merge
2. **Push 并创建 PR** — 推送到远端，创建 Pull Request
3. **保留分支** — 不做操作，后续继续
4. **丢弃工作** — 删除分支和 worktree（需用户确认）

### 3.2 Option 1：本地 Merge

```bash
# 1. 回到主工作目录
cd "$(git rev-parse --show-toplevel)"

# 2. 切到主分支，拉取最新
git checkout main
git pull origin main

# 3. Merge feature branch
git merge feat/agent-skill-batch-import

# 4. 验证测试通过
pnpm test

# 5. 测试通过后，删除 feature branch
git branch -d feat/agent-skill-batch-import

# 6. 清理 worktree
git worktree remove .worktrees/agent-skill-batch-import
```

**测试不通过则不得完成 merge。**

### 3.3 Option 2：Push 并创建 PR

```bash
# 1. 在 worktree 中推送
git push -u origin feat/agent-skill-batch-import

# 2. 创建 PR
gh pr create --title "feat(agent-skill): batch import" --body "..."

# 3. 清理 worktree（PR 创建后可选）
cd "$(git rev-parse --show-toplevel)"
git worktree remove .worktrees/agent-skill-batch-import
```

### 3.4 Option 4：丢弃工作

```bash
# 必须用户明确确认后才执行
cd "$(git rev-parse --show-toplevel)"
git worktree remove --force .worktrees/agent-skill-batch-import
git branch -D feat/agent-skill-batch-import
```

---

## 4. 安全红线

| 红线 | 说明 |
|------|------|
| **不在 main 上直接开发** | 除非用户明确要求 |
| **不 force-push** | 除非用户明确要求，且不得 force-push 到 main |
| **测试不过不 merge** | merge 前必须验证测试通过 |
| **丢弃工作需确认** | 删除分支/worktree 前必须获得用户明确确认 |
| **Worktree 目录必须被 gitignore** | 创建前验证，未忽略则先添加 |
| **不提交敏感信息** | .env、API Keys、密码、私钥等 |
| **精确 git add** | 优先 `git add <具体文件>` 而非 `git add .`，避免误提交 |

---

## 5. 与开发流程的集成

### 5.1 完整周期

```
Plan Session (主工作目录)
  │  讨论 feature/plan，输出 plan + requirement
  │  创建 feature branch + worktree
  ▼
Develop Session (worktree 中)
  │  按 requirement 执行开发
  │  commit 到 feature branch
  ▼
Review Session (主工作目录)
  │  review worktree 中的代码（git diff / git log）
  │  通过 → 分支收尾（merge / PR）+ 清理 worktree
  │  不通过 → 回到 develop session 修复
  ▼
收尾
  │  更新 requirement 状态 → done
  │  更新 feature 追溯表
```

### 5.2 Worktree 使用时机

| 场景 | 是否使用 Worktree |
|------|-------------------|
| 常规 requirement 开发 | 推荐使用 |
| 纯文档修改 | 不需要，直接在主目录 |
| 紧急 hotfix | 可选，视复杂度 |
| 多个 requirement 并行 | 每个 requirement 一个 worktree |

---

## 6. .gitattributes 规范

项目根目录应配置 `.gitattributes` 确保跨平台一致性：

```gitattributes
# 文本文件强制 LF 换行
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.jsx text eol=lf
*.json text eol=lf
*.md text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.css text eol=lf
*.html text eol=lf
*.sh text eol=lf

# 显式标记二进制文件
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.woff binary
*.woff2 binary
*.ttf binary
*.eot binary
```

---

## 7. .gitignore 基础规范

孵化项目的 `.gitignore` 应至少包含：

```gitignore
# 依赖
node_modules/

# 构建产物
dist/
build/

# 环境配置
.env
.env.local
.env.*.local

# Worktree
.worktrees/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# 日志
*.log
logs/
```
