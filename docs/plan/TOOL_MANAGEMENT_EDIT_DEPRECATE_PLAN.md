# Tool Management Edit Deprecate Plan

## Goal
为工具管理前端补齐“修改工具”和“弃用工具”能力，并与现有 `/tools` 接口契约保持一致。

## Scope
- Frontend Tools 管理页面（工具列表操作、编辑弹窗、弃用确认）
- Frontend `toolService`（更新/弃用接口封装）
- Backend `/tools` 现有更新/删除接口复用与前端联调
- 功能与 API 文档同步

## Steps
1. 对齐现有工具接口能力，确认 `PUT /tools/:id` 与 `DELETE /tools/:id` 可直接支持编辑与弃用流程。
2. 在 `toolService` 中补充明确语义的方法（更新工具、弃用工具），统一前端调用入口。
3. 在工具管理列表新增“编辑”和“弃用”操作，编辑通过弹窗修改可编辑字段（名称、描述、分类、启用状态等）。
4. 实现弃用二次确认，提交后执行弃用请求并刷新列表，避免误操作。
5. 增加保存/弃用 loading 与错误提示，保证操作可感知、可回滚。
6. 完成前端 lint/build 验证，确保列表筛选、执行入口、权限集管理不受影响。
7. 更新 `docs/feature/AGENT_TOOL.md` 与 `docs/api/agents-api.md`，补充工具管理“修改/弃用”能力说明。

## Impacts
- Frontend: `frontend/src/pages/Tools.tsx`, `frontend/src/services/toolService.ts`
- Backend API: `/tools/:id`（PUT/DELETE）
- Docs: `docs/feature/AGENT_TOOL.md`, `docs/api/agents-api.md`

## Risks/Dependencies
- 当前“弃用”通过删除接口落地，需在文档中明确其语义（管理端弃用=下线/移除）。
- 部分系统内置工具若被弃用，可能影响 Agent 权限集与执行链路，前端需提示谨慎操作。

## Adjustment
- 根据最新交互要求，弃用入口由工具列表独立按钮调整为“编辑工具”弹窗内的危险操作。
- 工具列表仅保留“编辑”和“执行”，避免重复入口导致误操作。

## Adjustment v2
- 将“执行工具”与“编辑工具”进一步合并为右侧抽屉，使用 `执行/修改` Tab 切换，减少弹窗切换成本。
- 简化工具列表信息密度，移除低价值字段（如 Resource、能力标签计数等）并突出核心识别信息。
- 列表项增加提示词可见性标识（有提示词/无提示词）。
- 列表 header 标签由固定类型文案调整为展示工具分类（category），避免语义偏差。
