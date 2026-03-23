# EI Engineering Statistics Board（缓存）

## 1. 页面与职责

- 页面文件：`frontend/src/pages/EngineeringStatistics.tsx`
- 一级标签：`工程规模统计`、`文档热度`
- `工程规模统计` 负责快照触发、最新快照摘要、历史列表、快照详情抽屉
- `文档热度` 负责热度窗口切换、TopN 排行、权重配置抽屉

## 2. 大文件相关数据链路

- 数据来源：`latest.projects[].topLineFiles[]`
- `topLineFiles` 项结构：`filePath`、`lines`、`bytes`
- 页面内通过 `React.useMemo` 进行前端聚合与过滤，不新增后端接口
- 超限阈值常量：`LARGE_FILE_LINE_THRESHOLD = 1500`

## 3. 大文件告警交互（最近统计卡片）

- 告警条仅在超限文件数 `> 0` 时显示
- 告警文案：`有 N 个代码文件超过 1500 行，建议优化`
- 点击告警条打开 Modal：`showLargeFileModal`
- Modal 表格列：`#`、`所属模块`、`文件路径`、`行数`、`字节数`
- 数据按 `lines desc`（次级 `bytes desc`）排序

## 4. 模块名映射规则

- `metricType=docs` -> `Docs`
- `metricType=frontend` -> `Frontend`
- `projectId=workspace-backend` -> `Backend (src)`
- `rootPath` 前缀 `backend/apps/` -> `Backend (<appName>)`
- 兜底显示 `projectName`
