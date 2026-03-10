# Qwen Max AIV2Provider 接入计划

## 需求理解

- 当前 Agent 在调用 `alibaba/qwen-max` 时提示「API 调用暂未实现」。
- 用户要求在 agents 中完成 Qwen 模型接入，并优先复用 `AIV2Provider` 调用链。
- 目标是在不新增平行调用实现的前提下，将 Qwen 纳入现有 provider 路由、密钥策略与 runtime 事件输出。

## 执行步骤

1. 梳理 `AIV2Provider` 的 provider 注册与模型路由，定位 `alibaba/qwen-max` 未命中实现的缺口。
2. 在 `AIV2Provider` 内补全 `alibaba` provider 适配（鉴权、endpoint、请求参数、错误映射）。
3. 将 `qwen-max` 纳入模型调用映射，确保普通对话与流式输出均走 AIV2 链路。
4. 对齐 API Key 读取策略，保证 `alibaba` provider 在显式 key、默认 key 与回退策略下行为一致。
5. 增加/更新测试覆盖成功、鉴权失败、限流、超时等核心场景，并执行构建回归。
6. 更新功能/API 文档，补充 Qwen 通过 AIV2 接入的配置方式与已知限制。

## 关键影响点

- 后端：`backend/libs/models`（AIV2 provider 适配与模型路由）
- 后端：`backend/apps/agents`（模型调用与 runtime 输出一致性）
- 配置：API Key provider=`alibaba` 的读取与默认策略
- 测试：providers 与 agents 相关构建/回归
- 文档：`docs/feature`、`docs/api`（如存在外部接口变更）

## 风险与依赖

- Qwen 端点可能存在 DashScope 原生接口与 OpenAI 兼容接口差异，需以仓库现有 AIV2 设计为准。
- 流式返回字段与 usage 统计可能与现有 provider 不同，需要做统一事件映射。
- 若当前环境未配置可用的 Alibaba API Key，连通性验证需通过 mock/单测补齐。

## 验证方式

- Agent 调用 `alibaba/qwen-max` 不再返回「API 调用暂未实现」。
- 非流式与流式调用均能产出系统既有消息/事件结构。
- 关键回归命令（如 `build:agents` 与相关测试）通过。
