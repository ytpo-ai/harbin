# Meeting 显式短语命令技术说明

## 1. 命中语法

- 仅当短语以方括号包裹时触发：`[短语]` 或 `【短语】`
- 不使用方括号时，不触发意图路由
- 短语比较采用小写与空白归一化

## 2. 短语清单（中文/英文各一条）

| 能力 | 中文短语 | 英文短语 |
|------|----------|----------|
| 模型列表查询 | `当前有哪些模型` | `list models` |
| 最新模型搜索 | `搜索最新openai模型` | `search latest openai models` |
| 记录备忘录 | `记录到备忘录` | `append to memo` |
| 操作日志查询 | `查看操作日志` | `operation log` |
| Agent 列表查询 | `查看agent列表` | `list agents` |

## 3. 使用示例

- `[当前有哪些模型]`
- `【list models】`
- `[记录到备忘录]`

## 4. 前后端联动

- 后端：`backend/src/modules/meetings/meeting.service.ts`
  - `extractBracketCommands`
  - `hasBracketPhraseIntent`
  - `is*Intent` 系列方法
- 前端：`frontend/src/pages/Meetings.tsx`
  - 输入 `[` 或 `【` 触发短语建议
  - 选择建议后自动填入完整短语（含方括号）
