# Plan: Agent "只说不做" 修复 -- Prompt 强化 + After-Step Hook 运行时兜底

## 背景

Agent 在收到工具执行指令时，连续多轮输出自然语言描述（如"收到，正在执行"）但不输出 `<tool_call>` 标签，导致工具从未被实际调用。

## 目标

通过 Prompt 强化（方案 2）+ After-Step Hook 运行时检测（方案 1）同时生效，彻底杜绝此类问题。

## 执行步骤

### Step 1: 强化 `toolInjectionInstruction` prompt 模板
- 文件：`backend/apps/agents/src/modules/prompt-registry/agent-prompt-catalog.ts`
- 添加负面示例、格式锚定、"没有 `<tool_call>` 标签 = 没有调用"的明确规则
- 影响：所有 agent 的 toolset system prompt

### Step 2: 强化 `toolStrategyWrapper` prompt 模板
- 同文件
- 替换模糊的"当可能使用工具得到时"为强制性措辞
- 明确"自然语言描述不等于工具调用"

### Step 3: 新增 `toolIntentRetryInstruction` prompt 模板
- 同文件
- 将 after-step hook 注入的修正指令纳入 prompt registry 管理，支持热更新

### Step 4: 实现 After-Step Hook 工具意图检测
- 文件：`backend/apps/agents/src/modules/agents/hooks/agent-after-step-evaluation.hook.ts`
- 检测：response 包含工具意图语言但无 `<tool_call>` 标签
- 匹配时：`retryRequested: true` + 修正指令
- 重试上限：最多 2 次，超过后 accept + warn 日志

### Step 5: 验证
- typecheck 通过
- 现有测试通过

## 影响范围
- 后端 prompt 模板（agent-prompt-catalog.ts）
- 后端 hook 逻辑（agent-after-step-evaluation.hook.ts）
- 无 API / 数据库 / 前端变更

## 关联文档
- Fix 记录：`docs/issue/fix/2026-03-23-agent-tool-intent-without-execution.md`
