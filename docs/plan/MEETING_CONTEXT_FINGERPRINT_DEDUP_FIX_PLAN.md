# Meeting 场景 Fingerprint 去重导致系统提示丢失修复计划

> 状态：进行中
> 创建时间：2026-04-08
> 类型：fix

## 问题描述

通过飞书 bot 发起的 1 对 1 聊天（meeting 场景），agent 在第二次及之后的消息回复中完全丢失系统提示（identity、tools、collaboration、task context），导致 agent 声称自己没有任何工具、无法描述自身能力。

## 根因分析

`ContextFingerprintService.resolveSystemContextBlockContent()` 的去重机制假设有 session 缓存配合——fingerprint 相同时返回 `null` 表示"不需要重复注入，session 缓存中已有"。

但 meeting 场景下 `buildMessages()` 拿不到 `sessionId`（meeting orchestration 不传 `sessionContext`，session 创建在 `startRuntimeExecution` 中晚于 `buildMessages`），导致：

1. 不会写入 session 系统消息缓存
2. 不会从 session 系统消息缓存读取
3. 但 fingerprint 去重仍然生效（基于 `meeting:{meetingId}:agent:{agentId}` scope）

结果：第一次消息正常注入，第二次及之后 fingerprint 命中返回 `null`，所有系统提示丢失。

## 修复方案

### Step 1：`context-fingerprint.service.ts` 增加 `skipDedup` 选项

为 `resolveSystemContextBlockContent` 增加 `skipDedup?: boolean` 参数。当 `skipDedup = true` 时跳过 fingerprint 比较，始终返回 `fullContent`（仅更新缓存）。

### Step 2：`context-block-builder.interface.ts` 扩展 `ContextBuildInput`

增加 `skipDedup?: boolean` 字段，供各 builder 读取并透传。

### Step 3：`agent-executor.service.ts` 中根据 `sessionId` 有无设置 `skipDedup`

在 `buildMessages()` 调用 `contextAssembler.assemble()` 时，当 `sessionId` 不存在（即无 session 缓存保底）设置 `skipDedup = true`。

### Step 4：各 context builder 透传 `skipDedup`

所有调用 `resolveSystemContextBlockContent` 的 builder 从 `input.skipDedup` 读取并透传。

### Step 5：更新/新增测试

为 fingerprint service 的 `skipDedup` 行为新增测试用例。

## 涉及文件

| 文件 | 改动类型 |
|------|---------|
| `context-fingerprint.service.ts` | 接口增强 |
| `context-block-builder.interface.ts` | 类型扩展 |
| `agent-executor.service.ts` | 逻辑修改 |
| `identity-context.builder.ts` | 透传参数 |
| `toolset-context.builder.ts` | 透传参数 |
| `domain-context.builder.ts` | 透传参数 |
| `collaboration-context.builder.ts` | 透传参数 |
| `task-context.builder.ts` | 透传参数 |
| `context-fingerprint.service.spec.ts` | 新增测试 |

## 影响范围

- 后端：context 组装模块
- 不影响前端、API 接口、数据库 schema
- `skipDedup` 默认 `false`，对 orchestration/plan 等已有 session 缓存的场景无影响
