# Engineering Statistics History Snapshot Development Summary

## 1. 背景

- 现有 `工程统计` 页面已支持触发统计与基础结果查看，但历史记录区域为简化卡片流，缺少筛选、分页与详情化查看能力。
- 本轮目标是在不改动后端接口契约的前提下，补齐“历史列表 + 快照详情抽屉”体验闭环。

## 2. 实现内容

### 2.1 页面信息架构调整

- `EngineeringStatistics` 页面重构为“历史列表主视图 + 快照详情抽屉”。
- 历史列表作为默认入口，优先满足浏览与定位需求。
- 详情通过右侧抽屉承载，避免离开当前上下文。

### 2.2 历史列表能力补齐

- 接入状态筛选：`all/running/success/failed`。
- 接入拉取条数控制：20/50/100。
- 增加前端分页（每页 10 条），支持上一页/下一页切换。
- 列表字段完善：统计时间、状态、范围、Token 模式、项目数、总字节、触发人、耗时、操作。

### 2.3 快照详情抽屉

- 支持通过行操作“查看快照”打开抽屉。
- 抽屉内增加 3 个 Tab：`汇总`、`项目明细`、`异常信息`。
- `项目明细` 复用快照 projects 数据，保留项目级失败状态提示。
- `异常信息` 聚合快照级 errors 与项目级 error 字段，去重后展示。

### 2.4 跳转与刷新联动

- 支持 URL `snapshotId` 深链打开，兼容消息中心跳转。
- 历史列表存在 `running` 快照时自动轮询刷新。
- 抽屉详情在 `running` 状态下自动轮询刷新。
- 触发统计后联动刷新 latest/history/selected 快照数据。

## 3. 质量与验证

- 前端构建验证通过：在 `frontend/` 执行 `npm run build`（含 TypeScript 编译）。
- 已处理 TypeScript 无用变量报错（移除未使用的 `latestLoading`）。

## 4. 影响文件

- 前端页面：`frontend/src/pages/EngineeringStatistics.tsx`
- 计划文档：`docs/plan/ENGINEERING_STATISTICS_HISTORY_SNAPSHOT_PLAN.md`
- 功能文档：`docs/feature/ENGINEERING_INTELLIGENCE.md`
- 日志文档：`docs/dailylog/day/2026-03-13.md`

## 5. 后续可选优化

- 从消息中心跳转后，对历史列表目标行进行高亮与自动滚动定位。
- 为筛选、分页、抽屉 Tab 与失败重试补充页面级测试。
