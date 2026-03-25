# Agency-Agents Prompt 导入编排问题修复记录

## 1. 基本信息

- 标题：Agency-Agents Prompt 导入在编排任务中反复 `TASK_INABILITY` / redesign 失败
- 日期：2026-03-24
- 负责人：OpenCode
- 关联需求/会话：
  - Plan `69c181d953a3c074f2eca7f6`
  - Plan `69c1ca1dd782fc656daf3ac5`
  - Plan `69c1cc0ee180dc61840ad3c4`
  - Plan `69c1cf9e7bcb2d3e64c7dc1c`
  - Plan `69c1d3a57bcb2d3e64c7ddca`
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：
  - 导入任务频繁失败，报错 `General output validation failed: agent reported inability to execute task ... task_inability`
  - 部分轮次出现 `Failed task ... not found for redesign`
- 触发条件：
  - 编排器生成 `action=redesign` 时，`redesignTaskId` 与任务实体 ID 类型不一致（业务 `task-xxx` vs Mongo `_id`）
  - 执行 Agent 在工具调用阶段因命令形态、输出截断或自判权限问题提前返回 `TASK_INABILITY`
- 影响范围：
  - `orchestration` 增量规划（generate-next）
  - Prompt 导入类任务（repo-writer/repo-read/prompt-registry.save-template）
- 严重程度：中-高（任务无法稳定收敛）

## 3. 根因分析

- 直接原因：
  - redesign 目标任务查找只按 `_id`，无法兼容 `task-...` 业务 ID
  - 执行 Agent 在会话中多次将可继续执行场景直接上报 `TASK_INABILITY`
- 深层原因：
  - 失败任务上下文未稳定暴露可重设计的“任务业务 ID”，导致 planner 可能填错 `redesignTaskId`
  - 长链路全量导入任务在单任务轮次预算下不稳定，且命令约束导致重试成本高
- 相关模块/文件：
  - `backend/src/modules/orchestration/services/incremental-planning.service.ts`
  - `backend/src/modules/orchestration/planner.service.ts`
  - `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts`
  - `backend/test/orchestration/planner.incremental-redesign.spec.ts`
  - `backend/test/orchestration/incremental-planning.redesign-taskid.spec.ts`

## 4. 修复动作

- 修复方案：
  - 修复 redesign 任务查找逻辑，支持业务 `id` 与 `_id` 双通道匹配
  - 在 planner prompt 中显式输出失败任务 `taskId`，并要求 `redesignTaskId` 必须引用该值
  - 保留执行引擎原有失败语义，不以脚本旁路替代任务执行结果
- 代码改动点：
  - `incremental-planning.service.ts`
    - `failedTasks` 上下文新增 `taskId`
    - `redesignFailedTask` 改为 `$or: [{id}, {_id}]`（当 `_id` 可解析时）
  - `planner.service.ts`
    - 失败任务展示增加 `taskId`
    - 增加 `redesignTaskId` 取值约束说明
  - 新增测试：`incremental-planning.redesign-taskid.spec.ts`
  - 更新测试：`planner.incremental-redesign.spec.ts`
- 兼容性处理：
  - 同时兼容旧数据（Mongo `_id`）与新链路（业务 `id`）

## 5. 验证结果

- 验证步骤：
  - 单测验证：
    - `planner.incremental-redesign.spec.ts`
    - `incremental-planning.redesign-taskid.spec.ts`
  - 接口验证（携带授权）：
    - 创建/触发多个计划，观察 `generate-next` 与 run logs
    - 针对失败任务做重指派、重试、状态轮询
  - 数据验证：
    - 清理历史 prompt 记录后，定向导入 2 个文件并核对 `prompt_templates`
- 验证结论：部分通过
  - redesign `task not found` 问题已修复
  - 全量导入任务在执行 Agent 层仍可能触发 `TASK_INABILITY`
  - 定向 2 文件测试通过（Plan `69c1d3a57bcb2d3e64c7ddca`）：
    - `academic/academic-anthropologist.md`
    - `product/product-manager.md`
    - 任务状态 `completed`，并在库中存在对应 role 版本记录
- 测试与检查：
  - 目标单测 2 套件通过（3/3）
  - 计划执行链路完成多轮实测与日志核验

## 6. 风险与后续

- 已知风险：
  - 大体量全量导入在单任务内仍受 Agent 轮次预算与工具调用稳定性影响
  - Agent 可能错误上报“缺少 save-template 工具”（会话行为层问题）
- 后续优化：
  - 将全量导入拆分为“枚举清单任务 + 分批导入任务”
  - 在编排层增加“导入类任务硬性分段”与“工具可用性前置校验”
  - 对 `TASK_INABILITY` 增加结构化原因码，区分权限缺失与流程中断
- 是否需要补充功能文档/API文档：否（本次为编排修复与执行策略沉淀）
