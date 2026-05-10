# Plan: AGENT_SKILL_DISCUSSION_MODE_ACTIVATION_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | AGENT_SKILL |
| 需求管理 ID | |
| 所属项目 | |
| OpenCode Session | |
| 状态 | done |
| 优先级 | high |
| 创建日期 | 2026-04-28 |

## 2. 背景

- 当前 Skill 分类以 `meeting/plan/general` 为主，缺少“讨论（discussion）”这一高频协作场景分类。
- 讨论场景下运行时尚未提供明确的 Skill 激活策略，导致讨论类 Skill 难以被稳定触发。

## 3. 目标

1. Skill 分类新增 `discussion`，前后端统一识别。
2. Agent Runtime 新增 `discussion` 场景识别与上下文注入兼容。
3. 在 discussion 模式下优先激活讨论类 Skill（按 category / name / tags 命中）。

## 4. 执行步骤

1. [x] 扩展 Skills 页面分类选项与中英文别名映射，支持 `discussion`。
2. [x] 扩展 Runtime Scenario 类型：`discussion` 纳入 `scenarioMode` 与 `scenarioType`。
3. [x] 扩展 collaboration context 构建：支持 discussion 场景上下文块注入。
4. [x] 扩展 Skill 激活策略：discussion 模式优先命中 discussion 类 Skill。
5. [x] 补充/更新单测，覆盖 discussion 激活正反例。
6. [x] 更新功能文档追溯与当日日志。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-002 | Skill 分类新增 discussion + 讨论模式激活策略 | [链接](../requirement/AGENT_SKILL_REQ-002_DISCUSSION_CATEGORY_AND_ACTIVATION.md) | done |

## 6. 关键影响点

- **前端**：Skills 分类筛选与展示。
- **后端（contracts）**：`CollaborationContext` 场景枚举扩展。
- **后端（runtime）**：scenario 解析、collaboration context 注入、skill 激活策略。
- **测试**：`context-strategy` 讨论场景激活测试。

## 7. 风险与回滚

- 风险：老数据/老缓存中的 skill 不包含 `category` 字段。
- 处理：运行时使用可选字段，保留 name/tags 信号兜底；不会阻断旧技能加载。
- 回滚：如需回滚，仅需移除 `discussion` 场景枚举与激活分支，前端分类可独立保留或同步回退。
