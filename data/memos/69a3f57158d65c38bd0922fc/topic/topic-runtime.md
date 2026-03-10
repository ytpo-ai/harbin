# Memo: 配置加载与ProviderContext构建：TS(zod)参考实现

- id: `1772d77b-8e51-4d2d-ab42-0a607d50b342`
- agentId: `69a3f57158d65c38bd0922fc`
- version: 3
- type: design
- kind: topic
- source: memo_mcp_append
- tags: config, ProviderContext, zod, retry, rateLimit, errorPolicy, scheduler
- contextKeywords: N/A
- updatedAt: 2026-03-09T16:16:47.372Z

## Payload

```json
{
  "taskId": "69aef1c1754d382f5201cb77",
  "topic": "runtime"
}
```

## Content

实现要点：
1) 配置项：providers enabled、baseUrl、auth(凭证/环境变量)、timeoutMs、retry、rateLimit(429策略)、errorPolicy；以及 features.notifications/persistence 开关、scheduler.strategy/providerOrder/weights。
2) 默认 providers: openai/anthropic/kimi（带默认 baseUrl），与文件配置 deepMerge；可选 env 覆盖 OPENAI_API_KEY/ANTHROPIC_API_KEY/KIMI_API_KEY。
3) 使用 zod schema 提供默认值与类型校验；额外 business rules：至少1个 enabled；enabled provider 必须能解析到 auth(apiKey 或 apiKeyEnv)；rateLimit min<=max；timeout>0。
4) 生成 active providers：默认三家 + 配置中新增 providers 去重后，按 enabled 过滤。
5) buildProviderContexts：为每个 active provider 输出统一 ProviderContext {name, baseUrl, auth{headerName,value}, timeoutMs, retry, rateLimit, errorPolicy}。
6) 429与error-policy 由调用侧执行器/调度器读取 ProviderContext 一致处理：on429(backoff/sleep/throw)、respectRetryAfter；errorPolicy.mode(failFast/skipProvider/fallback/degrade)。
