# Orchestration 异步 Agent Task 执行改造计划

## 需求背景

- 现状：计划编排执行链路在 `orchestration.service` 内同步等待 `executeTaskDetailed` 返回，长任务场景会受上游 HTTP timeout 影响，出现 504。
- 目标：将编排任务执行改为“提交异步任务 + 状态查询回传”，彻底移除 `orchestration` 对同步执行结果的阻塞等待，避免请求层超时误伤实际执行。

## 执行步骤

1. 在 `AgentClientService` 增加 Agent Task 异步调用能力
   - 新增创建任务与查询任务状态方法（`POST /api/agents/tasks`、`GET /api/agents/tasks/:taskId`）。
   - 补齐签名头与错误日志，保持与现有 agents-client 调用风格一致。

2. 改造 Orchestration 任务执行主路径
   - `orchestration.service.ts` 在 `executeTaskNode` 中改为提交异步 Agent Task，不再调用/等待 `executeTaskDetailed`。
   - 增加轮询等待逻辑：通过状态查询获取任务终态与结果，再回写 orchestration task 状态。

3. 扩展 Agent Task 结果落库
   - 调整 worker 完成态写入，持久化可复用的执行输出（至少包含 response 文本与长度），确保编排侧可取回用于校验与结果沉淀。

4. 保持执行语义兼容
   - 维持现有 `waiting_human / failed / completed` 判定规则、输出校验规则和 lifecycle 事件投递行为。
   - 对重试/取消场景保持兼容，不引入破坏性接口变更。

5. 文档与可观测性更新
   - 更新 `docs/feature/ORCHETRATION_TASK.md` 与相关 API 文档说明“编排执行改为异步任务驱动”。
   - 在当日日志记录改造影响范围。

6. 验证与回归
   - 覆盖顺序/并行计划、失败重试、长任务执行场景。
   - 验证长任务下不再因同步链路超时导致 504。

## 关键影响点

- 后端：`orchestration`、`agents-client`、`agent-task worker`。
- API：新增/复用异步任务状态读取契约。
- 可观测：任务状态推进从“同步返回驱动”改为“异步状态回传驱动”。

## 风险与依赖

- 风险：异步结果落库字段若不稳定，会影响编排输出校验。
- 风险：轮询窗口/超时策略配置不合理，可能导致编排误判失败。
- 依赖：`apps/agents` 中 Agent Task worker 稳定运行，且 `GET /agents/tasks/:taskId` 返回结果满足编排侧消费。
