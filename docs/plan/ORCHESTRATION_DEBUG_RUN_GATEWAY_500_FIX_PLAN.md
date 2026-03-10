# Orchestration Debug-Run Gateway 500 修复计划

## 1. 背景与目标

- 现象：调用 `POST /api/orchestration/tasks/:id/debug-run` 返回 `500 Gateway proxy failed`。
- 目标：定位网关代理失败根因，修复后保证 `debug-run` 请求可稳定透传并返回可诊断错误。

## 2. 执行步骤

1. 基于二级功能文档确认 `debug-run` 的目标行为、调用链和关键依赖（网关 -> orchestration service）。
2. 在本地复现报错，抓取网关层与上游服务日志，确认失败发生点（路由、代理、鉴权、上游异常）。
3. 校验 `debug-run` 代理配置（目标地址、path rewrite、method/body、headers 透传、timeout）与错误包装逻辑。
4. 按根因实施修复，并增强错误信息（至少包含上游状态码/简要上下文，避免仅返回通用 `Gateway proxy failed`）。
5. 增补或更新自动化测试，覆盖成功路径与典型失败路径。
6. 运行必要质量检查（lint/typecheck/相关测试），输出验证结果与风险说明。

## 3. 关键影响点

- 后端 API 网关与 orchestration 模块
- 代理配置与错误处理
- 测试用例（debug-run 路由）
- 文档（如涉及 API/行为变化）

## 4. 风险与依赖

- 上游 orchestration 服务未启动或端口/环境变量不一致会导致同类 500。
- task 状态前置条件不满足可能触发业务错误，需要和代理错误区分。
- 鉴权上下文（如组织信息、token）缺失会导致上游拒绝，需验证 header 透传。
