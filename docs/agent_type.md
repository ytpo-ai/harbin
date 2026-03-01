# Agent Type 规范

本文档维护系统内 Agent 类型清单。每个类型定义：

- `type`: 类型标识（唯一）
- `label`: 展示名称
- `defaultRole`: 默认角色（agent 实例级，可覆盖）
- `defaultPrompt`: 默认系统提示词模板

前端类型选择统一来源：`frontend/src/config/agentType.json`。

## 类型列表

| type | label | defaultRole | defaultPrompt（摘要） |
| --- | --- | --- | --- |
| `ai-executive` | 高管 | `executive-lead` | 负责战略方向、关键决策与跨部门协调 |
| `ai-management-assistant` | 高管助理 | `management-assistant` | 负责高管日程、纪要整理、任务跟进 |
| `ai-technical-expert` | 技术专家 | `technical-architect` | 负责技术架构、方案评估、技术风险控制 |
| `ai-fullstack-engineer` | 全栈工程师 | `fullstack-engineer` | 负责前后端实现、联调测试与交付 |
| `ai-devops-engineer` | 运维工程师 | `devops-engineer` | 负责部署发布、监控告警、稳定性保障 |
| `ai-data-analyst` | 数据分析师 | `data-analyst` | 负责数据分析、指标看板、洞察输出 |
| `ai-product-manager` | 产品经理 | `product-manager` | 负责需求规划、优先级管理、跨团队推进 |
| `ai-hr` | HR | `human-resources-manager` | 负责招聘、绩效、组织协同与人才发展 |
| `ai-admin-assistant` | 行政助理 | `administrative-assistant` | 负责行政事务、流程协调、会议保障 |
| `ai-marketing-expert` | 营销专家 | `marketing-strategist` | 负责市场策略、活动策划、增长转化 |
| `ai-human-exclusive-assistant` | 人类专属助理 | `human-exclusive-assistant` | 面向人类用户的个人事务协同与执行跟进 |
| `ai-system-builtin` | 系统内置 | `system-builtin-agent` | 平台内置能力代理与系统流程协同 |

## 维护规则

1. 新增类型时，必须同时更新：
   - `docs/agent_type.md`
   - `frontend/src/config/agentType.json`
2. `defaultRole` 仅作为默认值，允许在 Agent 编辑页按实例覆盖。
3. `defaultPrompt` 仅在创建/改类型时用于自动填充，不强制覆盖用户自定义 prompt。
4. 当前策略：历史 agent 将统一迁移到 `ai-system-builtin`，旧类型 profile 会清理。
