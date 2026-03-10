# Code Docs/Updates MCP 能力建设计划

> 状态：已完成开发，详见 `docs/development/CODE_DOCS_MCP_PLAN.md`。
> 更新时间：2026-03-08

## 概述

已实现多种工具来了解代码工程状态，支持三种实现方式：

| 工具 ID | 方式 | 优先级 |
|---------|------|--------|
| `repo-read` | bash 直接读取 | 1（默认） |
| `local-repo-docs-reader` / `local-repo-updates-reader` | 后端读取原始内容 | 2 |
| `gh-repo-docs-reader-mcp` / `gh-repo-updates-mcp` | 结构化摘要 | 3 |

## 工具详情

### repo-read
- 执行只读 bash 命令（git log, cat, ls, grep 等）
- 允许命令：`git log/show/diff`, `cat`, `ls`, `grep`, `head`, `tail`, `find`

### local-repo-docs-reader / local-repo-updates-reader
- 读取 docs/ 目录下的 markdown 文件
- 读取 git 提交记录

### gh-repo-docs-reader-mcp / gh-repo-updates-mcp
- 从文档提取功能特性
- 从提交分析变更主题（按主题聚合）

## 2026-03-08 增量计划（focus 命中诊断增强）

> 状态：已完成

1. 调整 `local-repo-docs-reader` 的 `focus` 过滤流程：优先按文件路径匹配，命中为 0 时自动降级为文档内容匹配。
2. 扩展返回信息：增加 `matchMode`、`focusMatchedCount`、`errorType`、`suggestions`，让 Agent 能定位失败原因。
3. 在 `tool.service.ts` 的 `getCodeDocsReader` 透传诊断字段，避免“无结果但无原因”的回复。
4. 保持兼容：不移除原有 `files/totalDocs/returnedFiles` 字段，保留 `maxFiles` 限制。
5. 完成后执行后端构建验证，确保 TypeScript 编译通过。

## 2026-03-08 增量计划（focus 自动兜底与单次可交付）

> 状态：已完成

1. `local-repo-docs-reader` 增加 focus 分词匹配（中英文关键词 OR 命中），避免整句 focus 导致 0 命中。
2. 无命中时不再直接报 `FOCUS_NO_MATCH`，自动回退到高优先级文档列表（README/feature/architecture/api）。
3. 输出增强：增加 `fallbackApplied`、`retryCount`、`attemptedKeywords`，便于 Agent 解释读取路径。
4. 在 `tool.service.ts` 透传上述字段，保证上层对失败/回退可观测。
5. 在 `agent.service.ts` 提示词中约束：遇到 0 命中必须自动重试或切换 repo-read，不向用户发起二选一追问。
