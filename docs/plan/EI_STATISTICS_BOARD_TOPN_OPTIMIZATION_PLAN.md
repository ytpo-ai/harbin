# 工程统计优化：大文件 Top N + Board 展示

## 需求概述

1. **后端大文件行数 Top N**：在文件系统扫描过程中收集每个文件的行数，排序取 Top N 作为大文件排行，存入快照
2. **前端工程统计 Board 展示**：概览卡片改造为按 docs / frontend / backend / backend apps 分组的 Board，展示文件数、代码行数、字节数

## 实施步骤

### Step 1 - 后端：FileMetrics 新增 topLineFiles

- 在 `scanDirectoryMetrics` 遍历过程中收集每个文件的 `{ filePath, lines, bytes }`
- 遍历结束后按 lines 降序排序取 Top 10，存入 `FileMetrics.topLineFiles`

### Step 2 - 后端：Schema 更新

- `EiStatisticsProjectRow` 新增 `topLineFiles?: Array<{ filePath: string; lines: number; bytes: number }>`
- `EiStatisticsSummary` 新增：
  - `totalDocsLines`、`totalFrontendLines`、`totalBackendLines`
  - `totalDocsFileCount`、`totalFrontendFileCount`、`totalBackendFileCount`

### Step 3 - 后端：buildSummary 补充新汇总字段

- 按 metricType 分组聚合 lines 和 fileCount

### Step 4 - 前端：接口定义同步

- 更新 `EngineeringStatisticsProjectRow` 和 `EngineeringStatisticsSummary` 类型

### Step 5 - 前端：概览卡片改造为 Board

- 按 docs / frontend / backend / backend apps 分组
- 每组展示文件数、代码行数、字节数

### Step 6 - 前端：快照详情抽屉展示大文件 Top N

- 在项目明细 Tab 中，点击某行可展开查看该项目的大文件 Top N 排行

## 影响点

- 后端：`ei.service.ts`（FileMetrics、scanDirectoryMetrics、buildSummary、buildStatisticsRows）
- 后端：`ei-project-statistics-snapshot.schema.ts`（Schema 类型定义）
- 前端：`engineeringIntelligenceService.ts`（接口类型）
- 前端：`EngineeringStatistics.tsx`（页面 UI）

### Step 7 - 前端：大文件警示条 + 弹框（待开发）

**需求**：在"最近统计"卡片底部添加警示条，提示超过行数阈值的代码文件数量，点击可弹出详细列表。

**数据来源**：
- 从 `latest.projects` 中提取所有 `topLineFiles`，筛选 `lines >= 1500` 的文件
- 纯前端计算，无需后端新增接口

**UI 设计**：

1. **警示条**（位于"最近统计"卡片底部）
   - 条件渲染：仅当超限文件数 > 0 时显示
   - 样式：`bg-amber-50 border-t border-amber-200`，左侧 `ExclamationTriangleIcon`
   - 文案：`有 N 个代码文件超过 1500 行，建议优化`
   - 整条可点击，点击弹出详细列表弹框

2. **弹框**（Modal）
   - 标题：`大文件警告 - 超过 1500 行`
   - 表格列：`#`、`所属模块`、`文件路径`、`行数`、`字节数`
   - 按行数降序排列
   - 底部关闭按钮

**实现要点**：
- 新增 state：`showLargeFileModal: boolean`
- 用 `React.useMemo` 从 latest snapshot 的所有 projects.topLineFiles 中筛选 `lines >= 1500` 的文件，附带所属 project 的 metricType 信息
- 阈值 `1500` 作为常量定义在组件顶部，便于后续调整

**影响文件**：
- `frontend/src/pages/EngineeringStatistics.tsx`（仅前端改动）

## 风险

- 无破坏性变更，新增字段向后兼容（旧快照无新字段时前端兜底显示 0 或 `-`）
- Step 7 警示条依赖 `topLineFiles` 数据，旧快照无此字段时警示条不显示，无副作用
