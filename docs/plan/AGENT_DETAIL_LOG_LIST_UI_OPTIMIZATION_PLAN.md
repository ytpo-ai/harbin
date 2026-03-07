# Agent Detail Log List UI Optimization Plan

## Goal

优化 Agent 详情页中的日志列表展示，提升可读性、扫描效率与状态识别能力，同时保持现有接口不变。

## Scope

- Agent 详情页日志 Tab（前端）
- 日志项信息层级与视觉样式（前端）
- 加载态/空态/错误态与分页可见性（前端）

## Plan

1. 梳理现有日志列表字段映射与展示痛点，明确主次信息层级（action/status 为主，context/task/tool/time 为辅）。
2. 重构日志列表卡片结构，增强状态可视化（状态标签、动作语义、关键信息分区）。
3. 优化日志明细排版与容错展示（长文本截断、空值兜底、详情键值更易读）。
4. 完善交互反馈（loading skeleton、空态、错误态、分页信息与可点击区域）。
5. 做响应式与样式一致性收口，确保桌面/窄屏均可稳定阅读。
6. 补充或更新相关文档说明（如涉及用户可感知行为变化）。

## Impact

- Frontend: `frontend/src/pages/AgentDetail.tsx`
- Frontend service: 复用 `frontend/src/services/agentActionLogService.ts`，不新增接口
- Backend/API: 无改动

## Risks / Dependencies

- 历史日志 `details` 字段结构可能不统一，需要稳健渲染策略。
- 展示信息较密集，需避免视觉噪音并兼顾移动端阅读。
