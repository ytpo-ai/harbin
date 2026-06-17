# MULTIMODAL_REQ-003：注册八字分析 Agent + life_script 通过 AgentClientService 调用 + API + 管理台 UI

| 字段 | 值 |
|------|-----|
| **状态** | pending |
| **优先级** | high |
| **关联 Plan** | `docs/plan/MULTIMODAL_MESSAGE_BAZI_AI_ANALYSIS_PLAN.md` §4 步骤 5-6 |

---

## 目标

1. 在 harbin Agent 系统中注册"八字分析 Agent"实体（绑定 Vision 模型 + bazi-data-generator Prompt）
2. life_script 后端导入 `AgentClientModule`，通过 `AgentClientService` 统一调用 Agent 服务
3. 新增 AI 分析截图生成 YAML 的 API
4. 新增 YAML 手动编辑保存 API（替代 seed 脚本）
5. 管理台前端新增"AI 分析生成 YAML"按钮和交互流程

## 验收条件

### Agent 实体注册

- [ ] 八字分析 Agent 已注册到 harbin Agent 系统
  - `name`: `bazi-screenshot-analyzer`
  - `model`: GPT-4o（或其他支持 Vision 的模型）
  - `systemPrompt`: 内化自 `bazi-data-generator` skill 的完整 Prompt
  - `tools`: 无（纯 LLM 调用）
- [ ] agentId 已配置到 life_script 后端环境变量（`BAZI_ANALYSIS_AGENT_ID`）

### 后端

- [ ] life_script 后端 `SubmissionModule` 导入 `AgentClientModule`
- [ ] `POST /api/admin/submissions/:id/analyze-screenshot` 接口可用
  - 从 submission 获取截图 URL
  - 构造 `AgentExecutionTask`，`task.messages` 含多模态 user 消息（`ContentPart[]`）
  - 通过 `AgentClientService.executeTask(agentId, task)` 调用 Agent 服务
  - 解析 Agent 返回的 YAML，写入 `submission.baziAnalysisYaml`
  - 返回解析结果（含 `needsConfirm`、`assumptions`）
  - 无截图时返回 400 错误
- [ ] `PATCH /api/admin/submissions/:id/yaml` 接口可用
  - 接收 YAML 字符串，写入 `submission.baziAnalysisYaml`
  - 校验 YAML 格式合法性
- [ ] AdminApiKeyGuard 鉴权保护

### 管理台前端

- [ ] 截图区域下方展示"AI 分析生成 YAML"按钮
- [ ] 按钮前置条件：已上传截图
- [ ] 点击后展示 loading 状态（含预估耗时提示）
- [ ] 成功后自动刷新 YAML 预览区域
- [ ] 展示 `needsConfirm` 和 `assumptions` 供管理员核对
- [ ] 支持在 YAML 预览区域手动编辑并保存

## 新增 API

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/admin/submissions/:id/analyze-screenshot` | AdminApiKeyGuard | AI 分析截图生成 YAML |
| PATCH | `/api/admin/submissions/:id/yaml` | AdminApiKeyGuard | 手动编辑保存 YAML |

## 调用链路

```
管理台前端 "AI 分析" 按钮
  → POST /api/admin/submissions/:id/analyze-screenshot
    → SubmissionService.analyzeScreenshot(submissionId)
      → AgentClientService.executeTask(BAZI_ANALYSIS_AGENT_ID, task)
        → HTTP POST agents-app/api/agents/{agentId}/execute
          → Agent 执行器 (system prompt + 多模态 user message)
          → AIV2Provider → GPT-4o Vision
      → 解析 YAML → 写入 submission.baziAnalysisYaml
    → 返回 { yaml, needsConfirm, assumptions }
  → 前端刷新 YAML 预览
```

## 新增环境变量

| 变量 | 说明 | 位置 |
|------|------|------|
| `BAZI_ANALYSIS_AGENT_ID` | 八字分析 Agent 的 ID | `workspace/life_script/backend/.env` |

## 依赖

- REQ-001 完成（多模态类型支持 + AIV2Provider 适配）
- REQ-002 完成（防御性修复）
- GPT-4o API Key 已配置在 harbin Agent 系统中
- OSS 截图 URL 可被 LLM 直接访问
- harbin Agent 服务（`:3002`）可被 life_script 后端访问
