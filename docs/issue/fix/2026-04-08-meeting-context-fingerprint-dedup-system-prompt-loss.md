# Meeting 场景 Fingerprint 去重导致系统提示丢失

> 修复时间：2026-04-08
> 关联 Plan：`docs/plan/MEETING_CONTEXT_FINGERPRINT_DEDUP_FIX_PLAN.md`

## 现象

通过飞书 bot 发起的 1 对 1 聊天（meeting 场景），agent 在第二次及之后的消息回复中完全丢失系统提示（identity、tools、skills、collaboration、task context），导致：
- Agent 声称自己没有任何工具
- Agent 无法描述自身身份和能力
- Agent 试图调用不存在的 `none` 工具被系统拒绝

第一次消息正常回复，问题从第二次消息开始出现。

## 根因

`ContextFingerprintService.resolveSystemContextBlockContent()` 的 fingerprint 去重机制与 meeting 场景的 session 缓存存在时序不匹配：

1. **Fingerprint 去重设计假设**：fingerprint 相同时返回 `null` 表示"不需要重复注入，session 缓存中已有上次的系统消息"
2. **Meeting 场景缺失 sessionId**：`meeting-orchestration.service.ts` 调用 `executeTask()` 时不传 `sessionContext`，`buildMessages()` 拿不到 `sessionId`
3. **Session 创建晚于消息构建**：meeting session 在 `startRuntimeExecution()` 中创建，但 `buildMessages()` 在此之前执行
4. **结果**：既无法写入/读取 session 系统消息缓存，fingerprint 去重却仍然生效（基于 `meeting:{meetingId}:agent:{agentId}` scope），第二次消息所有系统提示被跳过

### 受影响的 context builder

所有使用 `resolveSystemContextBlockContent()` 的 builder 均受影响：
- `IdentityContextBuilder`（agent identity + system prompt）
- `ToolsetContextBuilder`（工具定义）
- `DomainContextBuilder`
- `CollaborationContextBuilder`（会议上下文）
- `TaskContextBuilder`（meeting execution policy）

## 修复动作

在 `resolveSystemContextBlockContent()` 增加 `skipDedup` 选项，当没有 session 缓存保底时跳过 fingerprint 去重。

### 修改文件

| 文件 | 改动 |
|------|------|
| `context-fingerprint.service.ts` | 增加 `skipDedup` 参数，命中时返回 `fullContent` 而非 `null` |
| `context-block-builder.interface.ts` | `ContextBuildInput` 增加 `skipDedup` 字段 |
| `agent-executor.service.ts` | `buildMessages()` 中根据 `sessionId` 有无设置 `skipDedup = !sessionId` |
| `identity-context.builder.ts` | 透传 `input.skipDedup` |
| `toolset-context.builder.ts` | 透传 `input.skipDedup` |
| `domain-context.builder.ts` | 透传 `input.skipDedup` |
| `collaboration-context.builder.ts` | 4 处调用均透传 `input.skipDedup` |
| `task-context.builder.ts` | 2 处调用均透传 `input.skipDedup` |
| `context-fingerprint.service.spec.ts` | 新增 6 个测试用例覆盖 `skipDedup` 行为 |

## 验证结果

- TypeScript 编译通过（`tsc --noEmit` 无错误）
- 相关测试全部通过：
  - `context-fingerprint.service.spec.ts` PASS
  - `identity-context.builder.spec.ts` PASS
  - `task-context.builder.spec.ts` PASS
  - `context-fingerprint.util.spec.ts` PASS
  - `context-strategy.service.spec.ts` PASS

## 影响范围

- 修复 meeting 场景（包括飞书 bot 1v1 聊天）的系统提示丢失
- `skipDedup` 默认 `false`，对 orchestration/plan 等已有 session 缓存的场景无影响
- Meeting 场景下每次消息会完整注入系统提示（不做去重），增加少量 token 消耗，但保证系统提示完整性
