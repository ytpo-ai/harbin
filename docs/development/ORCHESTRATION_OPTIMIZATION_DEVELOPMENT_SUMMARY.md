# 计划编排与定时服务优化开发沉淀

## 目标
- 计划绑定定时服务时禁止删除，并给出明确提示
- 计划详情改为独立页面，支持从计划与定时服务直接跳转
- 周期性计划的执行历史仅展示最后一次

## 实施范围

### 后端
- `backend/src/modules/orchestration/orchestration.service.ts`：删除计划前检查关联定时服务
- `backend/src/modules/orchestration/scheduler/scheduler.controller.ts`：新增按 planId 查询接口
- `backend/src/modules/orchestration/scheduler/scheduler.service.ts`：新增按 planId 查询方法

### 前端
- `frontend/src/pages/PlanDetail.tsx`：新增计划详情独立页面
- `frontend/src/App.tsx`：新增 `/orchestration/plans/:id` 路由
- `frontend/src/pages/Orchestration.tsx`：计划详情打开新页面；删除前关联校验提示
- `frontend/src/pages/Scheduler.tsx`：关联计划跳转入口；关联计划仅展示最后一次执行
- `frontend/src/services/schedulerService.ts`：新增按 planId 查询接口

## 关键实现

1. 删除计划时，查询 `orchestration_schedules` 是否存在 `planId` 关联记录，存在则抛出异常并阻止删除。
2. 新增 `GET /orchestration/schedules/by-plan/:planId` 接口，供前端删除前校验。
3. 计划详情抽屉迁移为独立页面 `/orchestration/plans/:id`，保留调试与任务管理能力。
4. 定时服务详情中的执行历史：当存在 `planId` 关联时，仅请求最新一次执行记录。

## 影响范围
- 后端删除计划逻辑变更，新增查询 API
- 前端路由与页面结构更新，新增独立详情页
- 定时服务执行历史展示策略调整

## 验证
- 前端：`npm run build`
- 后端：`npm run build`

## 关联文档
- 规划文档：`docs/plan/ORCHESTRATION_OPTIMIZATION_PLAN.md`
- 功能文档：`docs/feature/ORCHETRATION_TASK.md`、`docs/feature/ORCHETRATION_SCHEDULER.md`
- API 文档：`docs/api/legacy-api.md`
