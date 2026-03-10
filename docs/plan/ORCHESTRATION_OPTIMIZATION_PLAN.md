# 计划编排优化 Plan

## 需求概述
1. 当计划绑定了定时时不能删除，删除时提示
2. 周期性计划只展示最后一次执行
3. 计划详情从右侧抽屉改成单独详情页，从计划和定时服务item都可以进入

## 执行步骤

### 1. 后端：删除计划时检查是否关联定时服务
- [x] 修改 `orchestration.service.ts` 的 `deletePlan` 方法
- [x] 在删除前查询 `orchestration_schedules` 集合中是否有 `planId` 匹配当前计划ID的记录
- [x] 如果有关联记录，抛出异常阻止删除

### 2. 后端：添加查询计划关联定时服务的接口
- [x] 在 scheduler.controller.ts 添加 `GET /orchestration/schedules/by-plan/:planId` 接口
- [x] 返回关联该计划的定时服务列表

### 3. 前端：创建计划详情页面
- [x] 创建 `frontend/src/pages/PlanDetail.tsx`
- [x] 复用现有 Orchestration.tsx 抽屉内的详情逻辑
- [x] 改为独立页面布局

### 4. 前端：添加路由
- [x] 在 `App.tsx` 添加路由 `/orchestration/plans/:id`

### 5. 前端：修改 Orchestration.tsx
- [x] 列表操作列的"查看详情"改为 `window.open('/orchestration/plans/' + planId, '_blank')`
- [x] 删除按钮添加检查：先调用接口检查是否有关联定时服务，如有则弹窗提示

### 6. 前端：修改 Scheduler.tsx
- [x] 定时服务列表的操作列添加"查看计划"按钮
- [x] 点击后打开新页面进入计划详情

### 7. 前端：周期性计划仅展示最后一次执行记录
- [x] 在定时服务详情中，关联计划仅展示最近一次执行记录

## 关键影响点
- 后端：修改删除逻辑、添加新接口
- 前端：新增页面、路由修改、两个列表页修改
- 需要处理关联检查的交互反馈

## 风险/依赖
- 需要确认现有定时服务是否已支持 planId 关联

## 变更文件清单

### 后端
- `backend/src/modules/orchestration/orchestration.service.ts` - 删除计划时检查关联定时服务
- `backend/src/modules/orchestration/scheduler/scheduler.controller.ts` - 新增查询接口
- `backend/src/modules/orchestration/scheduler/scheduler.service.ts` - 新增查询方法

### 前端
- `frontend/src/pages/PlanDetail.tsx` - 新建计划详情页
- `frontend/src/App.tsx` - 添加路由
- `frontend/src/pages/Orchestration.tsx` - 列表操作改为新页面打开
- `frontend/src/pages/Scheduler.tsx` - 添加跳转计划功能
- `frontend/src/services/schedulerService.ts` - 添加查询接口方法
