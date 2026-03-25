# Fix: Agent "只说不做" -- 描述工具调用意图但不实际执行

## 1. 基本信息

- 标题：Agent 用自然语言描述工具调用替代实际 `<tool_call>` 输出
- 日期：2026-03-23
- 负责人：Coder-Van
- 关联需求/会话：会议 a05a7921 -- 与 Coder-T 的 1 对 1 聊天（Repo Writer 工具联调测试）
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：用户要求 Coder-T 执行 `git-clone`，agent 连续 4 轮回复 "收到，正在执行"、"我现在就调用" 等自然语言描述，但始终没有输出 `<tool_call>` 标签，系统未执行任何工具
- 触发条件：agent 收到明确的工具执行指令时，模型选择输出描述性文本而非 `<tool_call>` 格式
- 影响范围：所有使用 native 执行引擎的 agent（text-based tool-call 协议）
- 严重程度：高 -- 工具完全无法被触发，核心能力失效

## 3. 根因分析

- 直接原因：LLM 生成了描述工具调用意图的自然语言文本，而非 `<tool_call>` 格式标签；`extractToolCall()` 返回 null，系统将文本当作最终回答直接返回
- 深层原因（3 层）：
  1. **Prompt 层**：`toolInjectionInstruction` 的"当你需要调用工具时"给了模型逃逸空间 -- 模型可先决定"我不调用，只描述"；`toolStrategyWrapper` 的"当可能使用工具得到时"措辞模糊，缺乏负面示例和格式锚定
  2. **After-Step Hook 空壳**：`agent-after-step-evaluation.hook.ts` 的 `run()` 永远返回 `{ decision: 'accept' }`，不检测响应内容就放行
  3. **无运行时兜底**：系统在 `extractToolCall()` 返回 null 后没有任何机制检测"模型是否打算调用工具但没有正确输出格式"
- 二次定位补充：Hook 初版 `execute()` 返回 `action: 'continue'` 而非 `'retry'`，已修复
- **三次定位（真正根因）**：`provideLifecycleHook()` 在 `AgentModule` 注册了 `LIFECYCLE_HOOKS_TOKEN` multi-provider，但 `HookRegistryService` 在 `RuntimeModule` 被实例化。NestJS multi-provider 是模块作用域的，跨模块不可见，导致 `discoveredHooks` 始终为空数组。启动日志 `[hook_registry_init] registered=0 hooks=[]` 证实了这一点
- 修复方式：移除 `AgentModule` 中的 `provideLifecycleHook()` 调用，改为 `AgentModule.onModuleInit()` 中通过 `HookRegistryService.register()` 手动注册
- 相关模块/文件：
  - `backend/apps/agents/src/modules/prompt-registry/agent-prompt-catalog.ts` -- prompt 模板定义
  - `backend/apps/agents/src/modules/agents/hooks/agent-after-step-evaluation.hook.ts` -- after-step hook（空壳）
  - `backend/apps/agents/src/modules/agents/agent-executor.service.ts:1261-1443` -- 无 tool_call 时的处理流程
  - `backend/apps/agents/src/modules/agents/agent-executor.helpers.ts:125-141` -- extractToolCall 解析

## 4. 修复动作

- 修复方案：方案 1（After-Step Hook 工具意图检测）+ 方案 2（Prompt 强化）同时执行

### 方案 2：强化 Prompt 模板

- `toolInjectionInstruction`：添加"绝对禁止的行为"负面示例 + 格式锚定 + 明确"没有 `<tool_call>` 标签 = 没有调用"
- `toolStrategyWrapper`：替换模糊措辞为强制性规则，明确"自然语言描述不等于工具调用"
- 新增 `toolIntentRetryInstruction` 模板：将 hook 注入的修正指令纳入 prompt registry 管理

### 方案 1：激活 After-Step Hook 运行时兜底

- 在 `agent-after-step-evaluation.hook.ts` 的 `run()` 中实现工具意图检测逻辑
- 检测模式：response 中包含工具调用意图语言（如"我正在调用"、"让我执行"）或提到具体工具名，但缺少 `<tool_call>` 标签
- 匹配时返回 `retryRequested: true` + 修正指令消息
- 重试次数上限：最多 2 次修正重试，超过后 accept 并输出 warn 日志
- 修复了控制指令下发漏洞：`execute()` 在 `retryRequested=true` 时返回 `action: 'retry'`，确保 `HookPipelineService` 正确置位 `result.retryRequested`
- 增补了反模式检测：覆盖"我不能调用工具"、"请在终端执行"、代码块内 `repo-writer clone` / `git clone` 的转交式回复，统一触发重试纠偏

### 代码改动点：
1. `backend/apps/agents/src/modules/prompt-registry/agent-prompt-catalog.ts` -- 修改 2 个模板 + 新增 1 个模板
2. `backend/apps/agents/src/modules/agents/hooks/agent-after-step-evaluation.hook.ts` -- 实现检测 + 重试逻辑
3. `backend/apps/agents/src/modules/agents/agent.module.ts` -- 移除 `provideLifecycleHook()`，改为 `onModuleInit()` 手动注册

### 兼容性处理：
- prompt 变更方向为收紧约束，不影响已正确调用工具的 agent
- hook 重试上限 2 次，避免无限循环
- 所有模板可通过 prompt registry 热更新覆盖

## 5. 验证结果

- 验证步骤：`npx tsc --noEmit --project apps/agents/tsconfig.app.json`
- 验证结论：通过（typecheck 零错误；`agent-executor.service.spec` 的 4 个失败用例为已有问题——`debugTimingProvider` 未 mock，与本次修改无关）
- 测试与检查：typecheck 通过，现有测试失败为 pre-existing

## 6. 风险与后续

- 已知风险：
  - 意图检测正则可能误判（agent 正常回复中提到工具名）-> 通过重试次数上限兜底，最多多调一次 LLM
  - prompt 变更影响所有 agent -> 收紧方向，正常行为不受影响
- 后续优化：
  - 可考虑实现 Before-Step Hook 事前预防（第 2 轮+ 注入提醒）
  - 可考虑基于 LLM 的语义级意图检测（替代正则），准确率更高但成本增加
  - 长期可评估是否迁移到 native function calling 协议（模型原生支持，无需 text parsing）
- 是否需要补充功能文档/API文档：否（内部运行时逻辑变更，无外部接口变化）
