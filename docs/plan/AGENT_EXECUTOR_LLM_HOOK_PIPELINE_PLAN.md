# Agent Executor LLM Hook 流程改造计划

## 背景

- 当前 `agent-executor.service.ts` 在执行链路中包含较多“关键词/文本匹配”式判断（如 `shouldForceModelManagementGrounding`、`tryHandleModelManagementDeterministically`）。
- 该方式可维护性较差，且难以平滑升级到多模型协同评审能力。
- 目标是将“执行前优化”和“执行后评估”标准化为 Hook，并以 LLM 语义判断为主，降低硬编码流程分支。

## 实施步骤

1. 设计并落地标准 Hook 协议：定义 before-step 与 after-step 的统一输入/输出结构、失败语义与降级策略。
2. 在 `modules/agents` 新增 Hook 文件，分别实现：
   - 执行前优化 Hook（含“是否触发新建计划编排”的语义增强）；
   - 执行后评估 Hook（对“添加成功”等输出进行语义核验与纠偏建议）。
3. 在 `agent-executor.service.ts` 增加标准调用节点：进入 step 时调用 before-step，step 完成后调用 after-step；主执行器只做编排与容错。
4. 将现有文本匹配逻辑收敛为兜底分支（可配置），默认以 Hook 判断结果为主，减少 deterministic 逻辑侵入主流程。
5. 增加日志与可观测字段（命中策略、Hook 耗时、评估结论、降级原因），支持后续替换更高效 LLM 模型进行优化与评审。
6. 补充/更新测试，覆盖 before-step 触发、after-step 评估命中、Hook 失败降级与旧逻辑兜底路径。

## 关键影响点

- 后端执行链路：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`
- 新增 Hook 模块：`backend/apps/agents/src/modules/agents/`（新增 hook 相关文件）
- 测试：`backend/apps/agents/src/modules/agents/**` 对应单测
- 功能文档：`docs/feature/AGENT_RUNTIME.md`

## 风险与依赖

- 纯 LLM 判断存在波动，需要明确 timeout、重试与 deterministic fallback 策略。
- 若 Hook 输出结构不稳定，可能影响后续执行分支，需要统一 schema 并做解析兜底。
- 执行链路新增 Hook 调用会增加少量时延，需要通过轻量模型/缓存策略控制。
