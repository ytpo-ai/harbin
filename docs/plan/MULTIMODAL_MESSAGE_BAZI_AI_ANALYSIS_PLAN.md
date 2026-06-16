# Plan：多模态消息支持 + 删除 V1 MoonshotProvider + 八字截图 AI 分析自动化

| 字段 | 值 |
|------|-----|
| **状态** | done |
| **优先级** | high |
| **创建日期** | 2026-06-16 |
| **关联功能** | `docs/feature/LIFE_SCRIPT.md` |

---

## §1 背景

life_script 管理台已支持管理员上传八字截图（`adminScreenshotUrl`），但"截图→YAML"环节仍依赖 opencode AI skill（`bazi-data-generator`）人工对话完成，且当前没有正式接口将生成的 YAML 写入 `submission.baziAnalysisYaml`（仅有一个 `seed-demo-yaml` 测试脚本，不属于正式流程）。

目标：自动化这一步。管理员在管理台点击按钮 → life_script 后端通过 `AgentClientService` 调用 harbin Agent 服务 → Agent 执行 Vision LLM 分析截图 → 生成 YAML → 写入 submission。

**统一调用范式**：life_script 及后续孵化项目统一通过 `AgentClientService` 调用 Agent 服务，与会议/编排模块保持同一架构范式，不直接引用 `@libs/models` 创建 Provider 实例。

实现前提：harbin LLM 层需要支持多模态消息（图片+文本）。当前 `ChatMessage.content` 为纯 `string`，不支持 `ContentPart[]`。

## §2 现状分析

### 2.1 Provider 路由现状

| Provider | 当前路径 | 是否有 V2 实现 |
|----------|---------|---------------|
| OpenAI | **V2** (AIV2Provider) | 是 |
| Alibaba/Qwen | **V2** (强制) | 是 |
| Anthropic | **V1** (AnthropicProvider) | 是（未启用） |
| Google | **V1** (GoogleAIProvider) | 是（未启用） |
| Moonshot/Kimi | **V1** (MoonshotProvider) | **是**（已有完整 V2 实现，未启用） |

### 2.2 关键差距

1. `ChatMessage.content` 为纯 `string`，不支持多模态消息
2. `AIV2Provider.formatMessages()` 继承基类默认实现，直接透传 `content`，未处理 `ContentPart[]` 格式转换
3. V1 `MoonshotProvider` 已被 AIV2Provider 完全覆盖，属于冗余代码
4. life_script 后端无"AI 分析截图"API，也无正式的 YAML 写入接口

## §3 方案选择

**最小改动方案**：

- 删除冗余的 V1 MoonshotProvider
- 仅在 AIV2Provider 中适配多模态 `formatMessages`
- V1 的 AnthropicProvider、GoogleAIProvider、OpenAIProvider **不动**
- 现有业务代码路径中 `content` 始终为 `string`，运行时零影响
- 对少数无类型守卫的 `message.content` 使用点加 `extractTextContent()` 防御

## §4 执行步骤

### 步骤 1：删除 V1 MoonshotProvider

**影响文件**（3 个）：

| 文件 | 改动 |
|------|------|
| `libs/models/src/v1/moonshot-provider.ts` | **删除文件**（及编译产物 `.js` / `.js.map` / `.d.ts`） |
| `libs/models/src/index.ts` | 删除 `export * from './v1/moonshot-provider'` |
| `apps/agents/src/modules/models/model.service.ts` | 删除 `MoonshotProvider` import；删除 `case 'moonshotai'/'moonshot'/'kimi'` V1 分支，改为统一走 V2 |

环境变量：`LLM_PROVIDER_V2_PROVIDERS` 加入 `moonshot`（或全量改为 `*`）。

**风险**：低。V2 中已有完整 Moonshot 实现（`aiv2-provider.ts:59-69`），功能等价。

### 步骤 2：扩展 ChatMessage 类型 + 工具函数

**影响文件**（2 个）：

| 文件 | 改动 |
|------|------|
| `libs/contracts/src/model.types.ts` | 新增 `ContentPart` 相关类型，`ChatMessage.content` 改为 `string \| ContentPart[]` |
| `libs/contracts/src/message.utils.ts`（新增） | 导出 `extractTextContent()` 工具函数 |

类型定义：

```typescript
export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image_url';
  imageUrl: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
  timestamp: Date;
  metadata?: any;
}
```

工具函数：

```typescript
export function extractTextContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is TextContentPart => p.type === 'text')
    .map(p => p.text)
    .join('');
}
```

**关键**：联合类型向后兼容，`string` 仍是合法值。现有所有传入 `string` 的代码无需改动。

### 步骤 3：AIV2Provider `formatMessages` 支持多模态

**影响文件**（1 个）：`libs/models/src/aiv2-provider.ts`

Override 基类 `formatMessages`，增加 `ContentPart[]` 处理：

- `content` 是 `string` → 保持 `{ role, content }` 原样（零影响）
- `content` 是 `ContentPart[]` → 转为 Vercel AI SDK 的 `UserContent` 格式：
  - `TextContentPart` → `{ type: 'text', text }`
  - `ImageContentPart` → `{ type: 'image', image: new URL(url) }` 或 `{ type: 'file', data: url, mimeType }`

V1 的 AnthropicProvider、GoogleAIProvider、OpenAIProvider **不动**。它们的 `formatMessages` / `separateMessages` 只会收到 `string` content（因为调用方不构造多模态消息），运行时行为不变。

### 步骤 4：防御性修复现有代码中的 string 假设点

**影响文件**（约 5-8 个，每个改 1-3 行）：

对无类型守卫的 `message.content.trim()` / `.replace()` / 模板拼接点加 `extractTextContent()` 包裹：

| 文件 | 改动数 | 说明 |
|------|--------|------|
| `discussion-sediment.service.ts` | 3 处 | `.content.trim()` / `.content.replace()` |
| `meeting-orchestration.service.ts` | ~6 处 | 模板拼接、intent 判断 |
| `runtime-persistence.service.ts` | 1 处 | `.content.length` |
| `memory-context.builder.ts` | 1 处 | 模板拼接 |
| `google-provider.ts` | 3 处 | `formatGeminiMessages` 中的字符串拼接 |

已有 `typeof msg.content === 'string'` 守卫的位置（agent-executor.helpers、opencode-execution 等约 5 处）**不需要改动**。

### 步骤 5：注册八字分析 Agent + life_script 后端通过 AgentClientService 调用

本步骤分为两部分：在 harbin Agent 系统中注册专用 Agent 实体，以及 life_script 后端通过统一的 `AgentClientService` 发起调用。

#### 5a：注册"八字分析 Agent"实体

在 harbin Agent 系统中注册一个专用 Agent（通过 seed 脚本或管理界面），配置：

| 字段 | 值 | 说明 |
|------|-----|------|
| `name` | `bazi-screenshot-analyzer` | Agent 标识名 |
| `model` | GPT-4o（或其他支持 Vision 的模型） | 绑定的 LLM 模型 |
| `systemPrompt` | `bazi-data-generator` skill 的 Prompt 逻辑 | 包含分区抽取规则、评分规则、数据结构模板、质量校验清单 |
| `tools` | 无（纯 LLM 调用，不需要工具） | 单次 Vision 分析，不走工具循环 |
| `skills` | 无 | — |

Agent 的 `systemPrompt` 将 `bazi-data-generator` skill（`workspace/life_script/.agents/skills/bazi-data-generator/SKILL.md`）中的执行流程、评分规则、数据结构模板、不确定性处理、质量校验清单等完整内化。

#### 5b：life_script 后端新增 AI 分析截图服务 + API

**影响**：`workspace/life_script/backend/src/modules/submission/`

新增接口：

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/admin/submissions/:id/analyze-screenshot` | AI 分析截图生成 YAML |
| PATCH | `/api/admin/submissions/:id/yaml` | 手动编辑保存 YAML |

AI 分析截图服务逻辑：
1. 从 submission 获取 `adminScreenshotUrl` 或 `baziScreenshotUrl`
2. 导入 `AgentClientModule`，注入 `AgentClientService`
3. 构造 `AgentExecutionTask`：
   - `task.messages` 中包含一条多模态 user 消息（`ContentPart[]` 含图片 URL + 文本指令）
   - `task.description` 中放文本指令摘要
   - `task.type` 设为 `'bazi-analysis'`
4. 通过 `AgentClientService.executeTask(baziAnalysisAgentId, task)` 调用 Agent 服务
5. Agent 服务使用绑定的 Vision 模型（GPT-4o）执行分析
6. 解析 Agent 返回的 YAML 字符串
7. 写入 `submission.baziAnalysisYaml`
8. 返回解析结果（含 `needsConfirm`、`assumptions`）

**调用链路**：

```
life_script 后端
  → AgentClientService.executeTask(agentId, task)
    → HTTP POST agents-app/api/agents/{agentId}/execute
      → AgentExecutorService.executeTaskDetailed()
        → buildMessages() 组装 system prompt + 多模态 user message
        → ModelService.chat() → AIV2Provider.chatWithMeta()
          → formatMessages() 转换 ContentPart[] → Vercel AI SDK 格式
          → generateText() 调用 GPT-4o Vision
  → 返回 YAML 字符串
```

**与其他业务模块同一范式**：与 `planner.service.ts`、`meeting-orchestration.service.ts`、`discussion-outline.service.ts` 等调用 Agent 的方式完全一致。后续孵化项目需要 AI 能力时，也统一走此路径。

### 步骤 6：管理台前端新增 AI 分析按钮

**影响**：`workspace/life_script/admin/src/views/submissions/SubmissionDetail.vue`

- 截图区域下方新增"AI 分析生成 YAML"按钮
- 前置条件：已上传截图（有 `adminScreenshotUrl` 或 `baziScreenshotUrl`）
- 点击后调用步骤 5 的 POST API
- 展示 loading 状态（Vision 分析约 30-60s）
- 成功后自动刷新 YAML 预览区域
- 展示 `needsConfirm` 和 `assumptions` 供管理员核对

## §5 Requirement 拆解

| ID | 标题 | 状态 | 关联步骤 |
|----|------|------|---------|
| MULTIMODAL_REQ-001 | 删除 V1 MoonshotProvider + ChatMessage 多模态类型扩展 + AIV2Provider 适配 | **done** | 步骤 1-3 |
| MULTIMODAL_REQ-002 | 防御性修复现有代码 string 假设点 | **done** | 步骤 4 |
| MULTIMODAL_REQ-003 | 注册八字分析 Agent + life_script 通过 AgentClientService 调用 + API + 管理台 UI | **done** | 步骤 5-6 |
| MULTIMODAL_REQ-004 | 动态 Agent 选择：移除 BAZI_ANALYSIS_AGENT_ID 硬编码，通过接口获取 Agent 列表 | **done** | 步骤 7-11 |

## §6 关键影响点

| 模块 | 风险 | 说明 |
|------|------|------|
| `libs/contracts` (类型) | **低** | 联合类型向后兼容 |
| `libs/models` (AIV2Provider) | **中** | `formatMessages` 需正确转换 ContentPart；`string` 路径不变 |
| V1 Providers | **无** | AnthropicProvider / GoogleAIProvider / OpenAIProvider 不动 |
| Agent 执行层 | **低** | `buildMessages` → `executeWithToolCalling` 对 content 是浅拷贝透传，多模态 content 原样到达 Provider |
| 业务层 (discussion/meeting) | **中** | 约 10 处加 `extractTextContent` 防御 |
| Agent 实体注册 | **低** | 新增 Agent seed，不影响现有 Agent |
| life_script 后端 | **中** | 导入 AgentClientModule，新增 API，不影响现有接口 |
| life_script 管理台前端 | **低** | 增量 UI 改动 |

## §7 风险与依赖

1. **Moonshot 切 V2 回归**：V2 中已有完整实现，风险低，但需确认行为一致
2. **TS 编译传播**：`content` 联合类型可能导致现有代码编译错误，需逐一修复
3. **Vision 模型选择**：需确认 GPT-4o API Key 已配置且可用
4. **OSS 图片可访问性**：LLM 需能直接访问截图 URL（确认无 ACL 限制）
5. **超时处理**：Agent 执行链路默认超时 120s（`AGENTS_EXEC_TIMEOUT_MS`），Vision 调用约 30-60s，在超时范围内
6. **Agent 实体管理**：八字分析 Agent 需要通过 seed 脚本或管理界面注册，agentId 需配置到 life_script 后端环境变量中

## §8 明确排除项

| 不动 | 原因 |
|------|------|
| V1 `OpenAIProvider` | 保留，OpenAI 已走 V2，但不在本次删除范围 |
| V1 `AnthropicProvider` | 保留，Anthropic 仍走 V1 |
| V1 `GoogleAIProvider` | 保留，Google 仍走 V1 |
| V1 `BaseAIProvider` | 保留，是 V1 provider 基类 |
| `base-provider.ts` `formatMessages` | 不改，V1 provider 继续用默认实现 |

## §9 架构范式说明

### 孵化项目统一调用 Agent 服务

本方案确立的架构范式：**所有孵化项目（包括 life_script 及后续项目）统一通过 `AgentClientService` 调用 harbin Agent 服务获取 AI 能力，不直接引用 `@libs/models` 创建 Provider 实例。**

```
孵化项目后端
  → import { AgentClientModule } from harbin
  → AgentClientService.executeTask(agentId, task)
    → HTTP → agents app → Agent 执行器 → LLM Provider
```

与会议、编排、讨论等模块完全同一调用路径。好处：

- **统一入口**：所有 AI 调用经过 Agent 服务，便于监控、计费、日志
- **关注点分离**：孵化项目不需要关心 Provider 细节、API Key、模型选择
- **能力渐进**：初期可以只用单次 LLM 调用，后续如需多轮对话、工具调用，Agent 基础设施天然支持
- **模型灵活**：切换模型只需修改 Agent 实体配置，不改业务代码

### 多模态消息透传保证

Agent 执行链路中，`task.messages` 中的多模态 `ContentPart[]` content 会被原样透传到 Provider：

```
task.messages (含 ContentPart[])
  → buildMessages() 浅拷贝追加到消息栈
  → executeWithToolCalling() 透传
  → ModelService.chat() 透传
  → AIV2Provider.chatWithMeta()
  → formatMessages() 转换为 Vercel AI SDK 格式
  → generateText() 调用 Vision LLM
```

中间层不触碰 `content` 内容，只有 `AIV2Provider.formatMessages()` 做最终格式转换。

## §10 优化：动态 Agent 选择（REQ-004）

### 背景

原实现中，八字分析的 Agent ID 通过环境变量 `BAZI_ANALYSIS_AGENT_ID` 硬编码在 life_script 后端。这要求每次注册新 Agent 后手动更新 `.env`，无法在管理台中动态选择不同 Agent 进行分析。

harbin Agent schema 已有 `projectId` 字段关联孵化项目，Agent API 已有 `GET /agents/active?projectId=xxx` 按项目筛选的能力。life_script 在孵化项目系统中已有对应记录。

### 目标

- life_script 管理台通过接口动态获取该项目下的 Agent 列表
- 管理员在截图分析前选择要使用的 Agent
- 移除对 `BAZI_ANALYSIS_AGENT_ID` 环境变量的强依赖（降级为可选 fallback）

### 步骤 7：life_script 后端新增 Agent 列表代理接口

**影响文件**：

| 文件 | 改动 |
|------|------|
| `workspace/life_script/backend/src/modules/submission/bazi-analysis.service.ts` | 新增 `getAvailableAgents()` 方法，代理调用 `GET /agents/active?projectId=<LIFE_SCRIPT_PROJECT_ID>` |
| `workspace/life_script/backend/src/modules/submission/admin-submission.controller.ts` | 新增 `GET /admin/agents` 端点 |

新增环境变量 `LIFE_SCRIPT_PROJECT_ID`，标识 life_script 在孵化项目系统中的项目 ID。

### 步骤 8：BaziAnalysisService 接受动态 agentId 参数

**影响文件**：`workspace/life_script/backend/src/modules/submission/bazi-analysis.service.ts`

修改 `analyzeScreenshot(submissionId, agentId?)` 方法签名：
- 传入 `agentId` → 使用传入值
- 未传入 → fallback 到 env `BAZI_ANALYSIS_AGENT_ID`
- 两者都没有 → 抛出 BadRequestException

### 步骤 9：修改 `POST analyze-screenshot` 接口

**影响文件**：

| 文件 | 改动 |
|------|------|
| `workspace/life_script/backend/src/modules/submission/admin-submission.controller.ts` | 接口接受 body `{ agentId?: string }` |
| `workspace/life_script/backend/src/modules/submission/dto/` | 新增 `AnalyzeScreenshotDto` |

### 步骤 10：admin 前端新增 Agent 选择下拉框

**影响文件**：

| 文件 | 改动 |
|------|------|
| `workspace/life_script/admin/src/views/submissions/SubmissionDetail.vue` | 截图分析区域添加 `<n-select>` Agent 选择器 |
| `workspace/life_script/admin/src/types/index.ts` | 新增 `AgentItem` 类型 |

### 步骤 11：更新 .env.example 和文档

**影响文件**：

| 文件 | 改动 |
|------|------|
| `workspace/life_script/backend/.env.example` | 新增 `LIFE_SCRIPT_PROJECT_ID`，标记 `BAZI_ANALYSIS_AGENT_ID` 为可选 |

### 关键影响点

| 模块 | 风险 | 说明 |
|------|------|------|
| life_script 后端 | **低** | 新增代理接口 + 修改已有接口签名，向后兼容 |
| admin 前端 | **低** | 增量 UI 改动，`<n-select>` 下拉框 |
| harbin Agent 服务 | **无** | 已有 `GET /agents/active?projectId=` 接口，无需改动 |
| 环境变量 | **低** | 新增 `LIFE_SCRIPT_PROJECT_ID`，`BAZI_ANALYSIS_AGENT_ID` 降级为可选 |
