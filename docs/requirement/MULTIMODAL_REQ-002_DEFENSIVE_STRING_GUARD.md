# MULTIMODAL_REQ-002：防御性修复现有代码 string 假设点

| 字段 | 值 |
|------|-----|
| **状态** | pending |
| **优先级** | high |
| **关联 Plan** | `docs/plan/MULTIMODAL_MESSAGE_BAZI_AI_ANALYSIS_PLAN.md` §4 步骤 4 |

---

## 目标

对现有代码中无类型守卫的 `message.content` 使用点加 `extractTextContent()` 防御，确保 `ChatMessage.content` 类型扩展后 TypeScript 编译通过且运行时安全。

## 验收条件

- [ ] 所有 `message.content.trim()` / `.replace()` / `.length` / `.includes()` / 模板拼接等无守卫调用点已加 `extractTextContent()` 包裹
- [ ] TypeScript 全量编译无错误
- [ ] 现有测试全部通过
- [ ] 已有 `typeof msg.content === 'string'` 守卫的位置无需改动

## 改动文件清单

| 文件 | 改动数 | 说明 |
|------|--------|------|
| `src/modules/discussions/services/discussion-sediment.service.ts` | 3 处 | `.content.trim()` / `.content.replace()` |
| `src/modules/meetings/services/meeting-orchestration.service.ts` | ~6 处 | 模板拼接、intent 判断方法入参 |
| `apps/agents/src/modules/agents/runtime-persistence.service.ts` | 1 处 | `.content.length` |
| `apps/agents/src/modules/agents/context/memory-context.builder.ts` | 1 处 | 模板拼接 |
| `libs/models/src/v1/google-provider.ts` | 3 处 | `formatGeminiMessages` 字符串拼接 |

> 具体行号和改动内容在开发阶段由 TS 编译错误驱动确认。
