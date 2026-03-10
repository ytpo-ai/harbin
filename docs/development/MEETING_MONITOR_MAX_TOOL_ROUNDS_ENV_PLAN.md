# 会议监控工具轮次环境化开发总结

## 变更背景

会议监控任务在多会议并发过期场景下需要连续调用多个 MCP 工具；原先 `maxToolRounds` 为硬编码 3，容易在一次巡检中提前耗尽调用轮次，导致仅处理部分会议。

## 本次实现

1. 将 Agent 工具调用轮次上限从硬编码改为环境变量读取：`MAX_TOOL_ROUNDS`。
2. 默认值设为 `30`，并增加非法值兜底：当配置为非数字、非有限值或 `<=0` 时，自动回退默认值。
3. 在环境变量样例中新增 `MAX_TOOL_ROUNDS=30`。
4. 在会议功能文档配置项中补充该变量说明，明确其对会议监控批量处理能力的影响。

## 具体改动文件

- `backend/apps/agents/src/modules/agents/agent.service.ts`
  - 新增 `DEFAULT_MAX_TOOL_ROUNDS = 30`
  - 新增 `getMaxToolRounds()` 读取与兜底逻辑
  - 将 `executeWithToolCalling` 内 `maxToolRounds` 改为动态读取
- `backend/.env.example`
  - 新增 `MAX_TOOL_ROUNDS=30`
- `docs/feature/MEETING_CHAT.md`
  - 配置项表新增 `MAX_TOOL_ROUNDS` 说明

## 验证结果

- 执行 `npm run build:agents`（在 `backend/`）通过，未出现 TypeScript 编译错误。

## 影响与后续建议

- 该改动提升了会议监控在大批量过期会议场景下的可处理上限。
- 轮次提升会增加单任务执行时长与 token/工具消耗；建议后续继续推进“批处理动作 + 幂等去重”以降低调用次数与重复动作风险。
