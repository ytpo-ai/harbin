# Plan: DISCUSSION_SPACE_ENRICH_SEARCH_AND_QUESTION_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 需求管理 ID | — |
| 所属项目 | 69f096d658f9498921a8bd27 |
| OpenCode Session | 当前会话 |
| 状态 | completed |
| 优先级 | high |
| 创建日期 | 2026-05-03 |

## 2. 背景

当前讨论空间在“丰富此章节”场景中，虽然会要求产出 `sourceUrl/sourceName` 字段，但链路没有强制 Agent 在本轮执行时先调用搜索工具，导致可能出现“有来源字段但无真实检索轨迹”的情况。与此同时，现有预置提示词要求“不要反问我”，会在信息不足时压制澄清问句，降低后续补充质量。

## 3. 目标

1. 章节丰富链路中，Agent 优先通过搜索引擎获取信息后再产出结构化条目。
2. 支持 Agent 在信息不足时提出必要反问（不再强制禁止反问）。
3. 前端消息区可展示“本轮检索来源/摘要”，提升可追溯性。

## 4. 执行步骤

1. [x] 调整章节 enrich 提示词（前端预置消息 + 后端 runtime 描述）
   - 明确要求先调用 web 搜索/抓取工具获取来源，再输出条目。
   - 移除“不要反问我”，改为“信息不足可先反问 1-2 个关键澄清问题”。

2. [x] 扩展后端 AI 回复解析能力
   - 在 `discussion-message.service.ts` 增加检索证据解析逻辑（`searchEvidence`）。
   - 在消息 `metadata` 中写入结构化证据，供前端直接渲染。
   - 保持旧格式兼容（仅有条目、无证据时不报错）。

3. [x] 前端展示检索证据
   - 扩展 `DiscussionMessage.metadata` 类型，新增检索证据字段。
   - 在 `MessageBubble` 增加“本轮检索来源”可折叠区域，展示来源名、URL、摘要、抓取时间。

4. [x] 兼容 enrichSection 兜底行为
   - 保持批量 enrich 的 JSON 解析与 fallback 逻辑稳定。
   - 允许澄清型响应进入下一轮交互，不再统一强制“禁止提问”。

5. [x] 更新测试与文档
   - 更新 service 相关测试，覆盖“有证据”“可反问”“旧格式兼容”场景。
   - 回写 requirement/feature 追溯与开发说明。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-025 | 丰富章节检索增强、支持反问与前端检索证据展示 | [链接](../requirement/DISCUSSION_SPACE_REQ-025_ENRICH_SEARCH_EVIDENCE_AND_QUESTION.md) | completed |

## 6. 关键影响点

- **后端**：`discussion-message.service.ts`、`discussion-outline.service.ts`、`discussion-message.schema.ts`
- **前端**：`DiscussionDetail.tsx`、`MessageBubble.tsx`、`discussionService.ts`
- **测试**：discussion message/outline service 相关 spec
- **文档**：`docs/plan`、`docs/requirement`、`docs/feature`

## 7. 风险与依赖

- 仅靠提示词无法 100% 强制工具调用；本期先做“强提示 + 证据展示”，后续可加“无检索轨迹拒绝入库”硬校验。
- 放开反问后，部分场景会先返回澄清问题，可能增加一轮交互，但信息质量可提升。
