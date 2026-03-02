# OpenAI Max Completion Tokens 兼容修复计划

## 需求理解

- 当前 Agent 模型连通性测试在调用 OpenAI 新模型（如 gpt-5.2）时失败。
- 报错显示请求参数不兼容：接口不支持 `max_tokens`，要求改用 `max_completion_tokens`。
- 需要在不影响现有旧模型的前提下，修复 chat/streaming/test 三条调用链。

## 执行步骤

1. 排查 OpenAI Provider 的请求构造逻辑，定位 `max_tokens` 的统一传参与复用点。
2. 新增 token 参数适配函数，根据模型族（如 `gpt-5*`）输出 `max_completion_tokens` 或 `max_tokens`。
3. 将适配逻辑应用到普通对话与流式对话请求，保持其他参数行为不变。
4. 复核 Agent 模型连接测试链路，确保走到新的参数映射逻辑。
5. 运行构建与必要验证，确认修复不引入编译或运行时错误。
6. 更新相关文档说明模型参数兼容策略，避免后续新增模型再次踩坑。

## 关键影响点

- 后端：`backend/libs/models` 的 OpenAI Provider 请求构造。
- API：模型测试连接、普通对话、流式对话返回稳定性。
- 测试：模型连接回归验证（自定义 key 与系统 key）。
- 文档：模型接入与参数兼容说明。

## 风险与依赖

- OpenAI 不同模型能力差异可能继续变化，适配策略需可扩展。
- 若后续切换到 Responses API，参数层仍需统一抽象避免重复改造。
- 当前仓库 lint 配置缺失，主要通过构建与功能验证保障质量。

## 验证方式

- 对 gpt-5.2 执行“测试模型连接”不再出现 `max_tokens` 参数错误。
- 对现有旧模型（如 gpt-4-turbo）对话能力保持可用。
- `npm run build:agents` 通过。
