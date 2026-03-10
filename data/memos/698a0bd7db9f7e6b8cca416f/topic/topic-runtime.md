# Memo: 主链路：逐Provider API快照采集（failure isolation）- 实现方案v1

- id: `2a54e61a-a9e6-4817-af48-720cb5b2b4bd`
- agentId: `698a0bd7db9f7e6b8cca416f`
- version: 1
- type: design
- kind: topic
- source: memo_mcp_append
- tags: provider-snapshot, failure-isolation, retry, 429-backoff, sanitization, reporting
- contextKeywords: N/A
- updatedAt: 2026-03-09T16:15:59.838Z

## Payload

```json
{
  "taskId": "69aef1c1754d382f5201cb7b",
  "topic": "runtime"
}
```

## Content

实现目标：按provider串行调用官方API拉取可用/在用模型列表；timeout/retry；429退避限速；保存raw响应（脱敏）与最小字段；单provider失败记录error并继续；最终产出运行报告。

主流程（串行+隔离失败）：
- 输入ProviderContext[]；for provider in providers 串行执行。
- 每个provider创建 runs/{runId}/{providerKey}/。
- try 调用 listModelsWithPolicy(provider)：
  - 统一HTTP封装：timeoutMs；maxAttempts；对网络错误/超时/5xx重试；对401/403/404等不重试；对429按Retry-After或指数退避+jitter。
  - 记录attempts.ndjson（ts,url,status,latencyMs,backoffMs,errorType）。
- 落盘：
  - meta.json（provider, endpoint, startedAt, policy摘要）
  - raw_headers.json（过滤Authorization/Cookie/X-Api-Key等）
  - raw_response.json（body脱敏：key/token/secret/password/authorization字段掩码；疑似JWT/长token掩码）
  - models_min.json（最小字段数组）
- catch：写 error.json（errorType,message,statusCode,endpoint,retryCount,lastBackoffMs,timestamp），report标记失败并continue。
- 最终写 runs/{runId}/report.json（成功/失败provider数、每家耗时、模型数、429次数、retry次数、partial标记）。

最小字段建议：{provider, modelId, displayName?, type?, contextWindow?, status?, createdAt?}

依赖Task#1超时的降级：允许ProviderContext不完整时将该provider记CONFIG_ERROR并继续；支持provider子集运行；优先读取缓存的ProviderContext。
