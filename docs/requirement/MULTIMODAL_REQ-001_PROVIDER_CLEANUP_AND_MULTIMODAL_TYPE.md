# MULTIMODAL_REQ-001：删除 V1 MoonshotProvider + ChatMessage 多模态类型扩展 + AIV2Provider 适配

| 字段 | 值 |
|------|-----|
| **状态** | pending |
| **优先级** | high |
| **关联 Plan** | `docs/plan/MULTIMODAL_MESSAGE_BAZI_AI_ANALYSIS_PLAN.md` §4 步骤 1-3 |

---

## 目标

1. 删除冗余的 V1 MoonshotProvider，Moonshot 统一走 AIV2Provider
2. 扩展 `ChatMessage.content` 类型为 `string | ContentPart[]`，支持多模态消息
3. AIV2Provider `formatMessages` 适配多模态 content，转为 Vercel AI SDK 格式

## 验收条件

- [ ] V1 `moonshot-provider.ts` 文件及编译产物已删除
- [ ] `libs/models/src/index.ts` 不再导出 MoonshotProvider
- [ ] `model.service.ts` 中 Moonshot 请求走 V2 路径
- [ ] `ChatMessage.content` 类型为 `string | ContentPart[]`
- [ ] 新增 `extractTextContent()` 工具函数并从 `@libs/contracts` 导出
- [ ] AIV2Provider `formatMessages` 正确处理 `ContentPart[]` → Vercel AI SDK 格式
- [ ] AIV2Provider `formatMessages` 对 `string` content 行为不变
- [ ] 现有所有测试通过
- [ ] TypeScript 编译无错误

## 改动文件清单

| 文件 | 操作 |
|------|------|
| `libs/models/src/v1/moonshot-provider.ts` | 删除 |
| `libs/models/src/v1/moonshot-provider.d.ts` | 删除 |
| `libs/models/src/moonshot-provider.js` | 删除 |
| `libs/models/src/moonshot-provider.js.map` | 删除 |
| `libs/models/src/index.ts` | 删除 moonshot-provider 导出 |
| `apps/agents/src/modules/models/model.service.ts` | 删除 MoonshotProvider import 和 V1 case 分支 |
| `libs/contracts/src/model.types.ts` | 新增 ContentPart 类型，扩展 ChatMessage.content |
| `libs/contracts/src/message.utils.ts` | 新增 extractTextContent 工具函数 |
| `libs/contracts/src/index.ts` | 导出 message.utils |
| `libs/models/src/aiv2-provider.ts` | Override formatMessages 支持多模态 |
