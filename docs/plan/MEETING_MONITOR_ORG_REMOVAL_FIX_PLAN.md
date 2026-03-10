# 会议监控去组织上下文修复计划

## 概述

现网 `meeting_monitor` 在执行 `builtin.mcp.meeting.list` 时触发 `Missing organization context for meeting_list`，导致无法获取 active 会议并中断后续“超时提醒/自动结束”流程。

## 目标

- 移除会议 MCP 工具对 organization context 的硬依赖。
- 保持现有单租户架构下的会议巡检链路可用。
- 不改变提醒阈值与会议状态流转行为。

## 执行步骤

1. 梳理会议 MCP 调用链（`meeting.list/sendMessage/updateStatus`）中的 organization 依赖点。
2. 调整工具实现：取消缺失 organization context 时的阻断报错，改为无组织上下文也可调用后端会议 API。
3. 清理工具元信息中与“组织”强绑定的文案，避免误导后续编排提示词。
4. 回归检查 meeting monitor 执行路径，确认可完成 `list(active) -> warning/end -> updateStatus(end)`。
5. 同步更新功能文档，记录会议 MCP 已按无组织上下文模式运行。

## 关键影响点

- **后端 / Agent Tools**: `backend/apps/agents/src/modules/tools/tool.service.ts`
- **会议编排运行链路**: Meeting Monitor 经由 MCP 调用会议 API 的稳定性
- **文档**: `docs/feature/MEETING_CHAT.md` 的 MCP 工具说明

## 风险与依赖

- 若仍存在网关或其他中间层对 organizationId 的强校验，需进一步放宽；否则工具层修复后仍可能失败。
- 需确保本次修改仅影响会议 MCP，不误改仍需组织隔离的其它能力（如 orchestration 相关工具）。

## 第二阶段：409 冲突修复（meeting monitor）

### 背景

在移除 organization context 阻断后，`meeting_monitor` 已可拉取 active 会议，但在执行 `meeting.sendMessage` 时出现 `409 Conflict`，导致“提醒/自动结束”链路中断。

### 目标

- 修复 monitor 场景下提醒消息发送冲突。
- 保证单条会议发送失败不会阻断其它会议处置。

### 执行步骤

1. 定位 `409` 触发路径，确认是否由“发送者不在会议中”校验导致。
2. 在会议消息模型与服务层补齐 `system` 发送者语义，允许系统消息用于运维/巡检提醒。
3. 调整 meeting MCP 发送者策略：仅在真实会议上下文中沿用 agent 身份，其它巡检场景使用 system 发送者。
4. 重新触发 `system-meeting-monitor`，验证提醒与结束动作是否恢复执行。
