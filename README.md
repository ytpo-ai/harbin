# AI Agent Team Platform

一个创新的AI Agent创业公司模拟平台，支持多模型接入的Agent团队协作管理，模拟真实公司的组织架构、成本核算、人力资源和决策治理。

## 终极目标
- 系统将由自己进化成更高效率，更低成本的多agent协作团队，系统将有agent在日常工作中迭代完善，而不是完全由人来设计；
- 系统区别于当前火爆的只满足单个人类Agent平台，系统支持多个人类员工跟agent一起合作；
- 系统支持多模型接入，根据不同任务需求选择最合适的模型；
- 系统通过长期运行，最终会进化出一批在各种任务中表现优异的agent；

## 🌟 核心特色

- 🏢 **完整的公司架构模拟** - 股权分配、角色体系、部门结构
- 🤖 **多AI模型集成** - 支持OpenAI、Claude、Gemini、Kimi等主流模型
- 👥 **智能Agent管理** - 个性化配置、工具权限、绩效评估
- 💼 **HR管理系统** - 自动绩效评估、团队健康度分析、招聘建议
- 🛠️ **工具生态** - 代码执行、网络搜索、数据分析等多种工具
- 🎥 **会议室系统** - 支持7种会议类型、独立新会议页、@成员提示与右侧会议管理区
- 🧭 **任务编排与会话中台** - 一句话生成执行计划，支持 Agent/Human 分派与统一 Session 管理
- 📨 **统一消息中台** - 会议/讨论/编排会话消息统一沉淀到 `messages`，便于模型评测与Agent绩效分析
- 🧠 **Skill 管理中台** - AgentSkillManager 自动检索技能、给 Agent 提供能力增强建议，并同步 DB+Markdown

> 当前状态：`组织管理` 与 `公司治理` 模块前后端功能已下线，后续将按新方案重构。

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- MongoDB >= 5.0
- 内存 >= 4GB (推荐)
- 磁盘空间 >= 2GB

### 安装步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd ai-agent-team-platform
```

2. **安装依赖**
```bash
npm run install:all
```

3. **配置API密钥**
```bash
cp backend/.env.example backend/.env.development
# 编辑 backend/.env.development，填入你的AI模型API密钥
```

4. **启动MongoDB**
```bash
# 确保MongoDB服务正在运行
mongod
```

5. **启动项目**
```bash
./backend/start.sh development
```

6. **访问应用**
- 前端界面: http://localhost:3000
- 后端API: http://localhost:3001
- API文档: http://localhost:3001/api/docs

## 🏗️ 技术架构

### 后端技术栈
- **框架**: Nest.js + TypeScript
- **数据库**: MongoDB + Mongoose
- **AI模型**: OpenAI, Anthropic Claude, Google Gemini, Kimi (Moonshot)
- **认证**: JWT
- **文档**: Swagger/OpenAPI

### 前端技术栈
- **框架**: React 18 + TypeScript
- **路由**: React Router
- **状态管理**: Zustand
- **数据获取**: React Query
- **UI框架**: Tailwind CSS + Headless UI
- **图标**: Heroicons
- **构建工具**: Vite

## 🎯 功能模块

### 1. 🏢 组织管理（已下线）

- 当前版本已移除组织管理相关前后端功能代码，待重构。

### 2. 🤖 Agent管理

#### 个性特征
每个Agent具有多维度个性特征(0-100分):
- **工作伦理**: 责任心和勤奋程度
- **创造力**: 创新和问题解决能力
- **领导力**: 团队管理和决策能力
- **团队协作**: 沟通和合作能力
- **学习能力**: 知识获取和技能提升速度

#### 创始团队
- **Alex Chen (CEO)**: 战略思维专家，95分领导力
- **Sarah Kim (CTO)**: 技术架构师，95分学习能力

#### 配置能力
- AI模型选择(OpenAI/Claude/Gemini/Kimi)
- 系统提示定制
- 能力标签配置
- 工具权限分配
- 激活状态管理
- Agent 卡片一键“开始聊天”（自动进入与该 Agent 的 1 对 1 会话）

### 3. 🛠️ 工具系统

#### 工具类型
| 工具类型 | 功能描述 | Token成本 | 权限要求 |
|----------|----------|------------|----------|
| WebSearch | 互联网信息检索 | 10 | Basic |
| Slack | 团队频道消息发送 | 15 | Intermediate |
| Gmail | 邮件草稿/发送 | 20 | Intermediate |
| Model MCP List Models | 查询系统模型清单 | 3 | Basic |
| Model MCP Search Latest | 互联网检索最新模型候选 | 8 | Basic |
| Model MCP Add Model | 模型入库（含去重） | 5 | Admin |
| Human Operation Log MCP List | 查询绑定人类操作日志 | 4 | Basic |
| 代码执行 | 执行代码片段 | 50 | Intermediate |
| 网络搜索 | 互联网信息检索 | 10 | Basic |
| 文件操作 | 文件读写管理 | 5 | Basic/Intermediate |
| 数据分析 | 数据处理分析 | 30 | Intermediate |
| 视频剪辑 | 视频内容处理 | 100 | Advanced |
| API调用 | 外部API集成 | 20 | Advanced |
| 自定义工具 | 用户定义工具 | 可配置 | 可配置 |

#### 权限分级
- **Basic**: 基础工具访问(网络搜索、文件读取)
- **Intermediate**: 中级工具(代码执行、数据分析)
- **Advanced**: 高级工具(API调用、视频剪辑)
- **Admin**: 管理员权限(所有工具)

#### 执行监控
- 实时执行状态跟踪
- Token消耗成本统计
- 成功率和效率分析
- 使用历史记录

#### 人类操作审计日志
- Gateway 会将已认证人类用户的 API 操作落库（含动作、资源、状态码、耗时、请求上下文脱敏摘要）
- 专属助理可通过 `human_operation_log_mcp_list` 查询绑定人类日志，且默认禁止跨人类访问
- 前端新增“日志查询”页面，支持人类用户检索全员操作日志（保持脱敏）

#### Agent工具调用
- 可在 Agent 创建/编辑时分配工具白名单（`tools` 字段）
- Agent 在聊天与任务执行中，仅可调用已分配工具
- 支持工具调用编排：模型输出 `tool_call` 指令 -> 系统执行工具 -> 返回结果继续回答
- 新增系统内置 `Model Management Agent`，默认可执行“联网搜索最新模型 -> 写入系统模型库”闭环

#### Composio 集成
系统已集成 [Composio](https://www.composio.dev) 平台，提供 1000+ 工具的统一接入：

**优势：**
- 一次配置，访问所有工具（Slack、Gmail、GitHub、Notion 等）
- 自动处理 OAuth 认证流程
- 无需单独管理各平台的 API Key
- 免费额度：1000 次/月

**配置步骤：**
1. 注册 Composio 账号：https://www.composio.dev
2. 获取 API Key：https://platform.composio.dev/settings
3. 在 Composio Dashboard 中连接需要的工具（Slack、Gmail 等）
4. 设置环境变量 `COMPOSIO_API_KEY`

**工具调用链：**
```
Agent 请求 -> ToolService -> ComposioService(@composio/core SDK) -> Composio API -> 真实服务
```

**技术实现：**
- 使用 `@composio/core` SDK 调用 Composio API
- SDK 自动处理会话管理和工具执行
- 代码示例：
```typescript
const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
const session = await composio.create({ userId: 'agent_123' });
const result = await session.executeAction({
  action: 'SERPER_DEV_SEARCH',
  params: { query: 'AI news' }
});
```

**降级策略：**
- 优先使用 Composio SDK（如果配置了 `COMPOSIO_API_KEY`）
- 备用方案：直接使用各平台 API（需单独配置）
- 最终备用：模拟结果（开发和测试环境）

### 4. 💼 人力资源系统

#### 绩效评估体系
5大核心KPI指标:
- **任务完成率**: 按时完成任务的百分比
- **代码质量**: 产出代码的质量评分
- **团队协作**: 与其他Agent合作的能力
- **创新能力**: 新想法和解决方案贡献
- **工作效率**: Token使用效率

#### 评估报告
- 个人综合评分(0-100分)
- 详细KPI分析
- 任务完成统计
- Token消耗分析
- 改进建议推荐

#### 团队健康度
- 整体团队表现等级(优秀/良好/一般/较差)
- 高/中/低绩效员工分布
- ROI成本效益分析
- 团队改进建议

#### 低绩效管理
- 自动识别低绩效Agent
- 淘汰风险评估
- 改进计划制定
- 终止建议生成

### 5. 🗳️ 公司治理系统（已下线）

- 当前版本已移除公司治理相关前后端功能代码，待重构。

### 6. 📈 动态扩张机制

#### 智能招聘
- **工作负荷分析**: 基于任务积压情况
- **部门利用率**: 各部门人员配置分析
- **招聘建议**: 自动生成招聘需求
- **岗位匹配**: 推荐合适的角色和薪资

#### 招聘流程
1. 生成招聘建议
2. 创建招聘提案
3. 董事会投票决定
4. 雇佣新Agent
5. 30天试用期管理
6. 正式员工转正

#### 组织优化
- 部门结构调整建议
- 角色配置优化
- 成本控制分析
- 效率提升方案

### 7. 💬 Agent协作系统

#### 协作模式
- **自由讨论模式**: Agent间自由交流讨论
- **流水线模式**: 按顺序传递处理任务
- **并行协作模式**: 多Agent同时处理
- **分级监督模式**: 高级Agent监督低级Agent

#### 消息类型
- **意见(opinion)**: 表达个人观点
- **问题(question)**: 提出疑问
- **同意(agreement)**: 表示赞同
- **反对(disagreement)**: 表达反对
- **建议(suggestion)**: 提出改进建议

#### 实时交互
- 消息类型智能识别
- Agent响应自动触发
- 讨论历史记录
- 结论总结生成

## 🌐 API接口

### 核心模块API

#### Agent管理 (`/api/agents`)
- `GET /` - 获取所有Agent
- `POST /` - 创建新Agent
- `PUT /:id` - 更新Agent信息
- `DELETE /:id` - 删除Agent
- `POST /:id/execute` - 执行Agent任务
- `GET /mcp/map` - 获取agents map（角色/工具集/能力集/暴露配置）
- `GET /mcp` - 获取MCP可见agent列表（支持 `includeHidden=true`）
- `GET /mcp/:id` - 获取单个agent的MCP能力详情
- `GET /mcp/profiles` - 获取数据库中的MCP profile列表
- `GET /mcp/profiles/:agentType` - 获取指定类型profile
- `PUT /mcp/profiles/:agentType` - 创建或更新profile（数据库驱动）

> 说明：MCP 能力配置已改为数据库驱动（`agent_profiles`）。CEO/CTO 在被询问“系统有哪些agents”时，会优先通过内置工具 `agents_mcp_list` 获取实时列表后回答。
>
> Agent 类型规范见 `docs/agent_type.md`，前端类型选择来源于 `frontend/src/config/agentType.json`。
> 当前系统支持：高管/高管助理/技术专家/全栈工程师/运维工程师/数据分析师/产品经理/HR/行政助理/营销专家/人类专属助理/系统内置。

#### Skill 管理 (`/api/skills`)
- `GET /` - 获取技能库（支持按 `status`、`category` 过滤）
- `POST /` - 创建技能
- `PUT /:id` - 更新技能
- `DELETE /:id` - 删除技能
- `POST /assign` - 为指定 Agent 绑定技能
- `GET /agents/:agentId` - 查询 Agent 已绑定技能
- `POST /manager/discover` - AgentSkillManager 互联网检索并入库
- `POST /manager/suggest/:agentId` - AgentSkillManager 生成技能增强建议
- `GET /suggestions/agents/:agentId` - 查询某 Agent 的建议记录
- `PUT /suggestions/:id` - 审核建议（accepted/rejected/applied）
- `POST /docs/rebuild` - 从数据库重建 `docs/skills` 文档

#### 工具管理 (`/api/tools`)
- `GET /` - 获取所有工具
- `POST /:id/execute` - 执行工具
- `GET /executions/history` - 执行历史
- `GET /executions/stats` - 执行统计

模型管理 MCP 工具：
- `POST /model_mcp_list_models/execute` - 查询系统当前模型列表
- `POST /model_mcp_search_latest/execute` - 联网检索最新模型候选
- `POST /model_mcp_add_model/execute` - 新增模型到系统（自动判重）

审计日志 MCP 工具：
- `POST /human_operation_log_mcp_list/execute` - 查询绑定人类操作日志（仅专属助理）

#### 人力资源 (`/api/hr`)
- `GET /performance/:agentId` - 绩效报告
- `GET /low-performers` - 低绩效员工
- `GET /hiring-recommendations` - 招聘建议
- `GET /team-health` - 团队健康度

#### 系统操作日志 (`/api/operation-logs`)
- `GET /` - 人类用户查询全员系统操作日志（支持时间范围/动作/资源/状态筛选与分页）

#### 会议室系统 (`/api/meetings`)
- `POST /` - 创建会议
- `POST /:id/start` - 开始会议
- `POST /:id/end` - 结束会议
- `POST /:id/join` - 加入会议
- `POST /:id/leave` - 离开会议
- `POST /:id/messages` - 发送消息
- `POST /:id/invite` - 邀请Agent
- `PUT /:id/title` - 修改会议名称
- `POST /:id/participants` - 添加参会人员
- `DELETE /:id/participants/:participantType/:participantId` - 移除参会人员
- `DELETE /:id` - 删除会议（支持未开始/已结束/已归档）
- `GET /` - 获取会议列表
- `GET /stats` - 获取统计信息

会议特性补充：
- Agent 管理页支持一键发起 1 对 1 聊天：优先复用已有会话，不存在时自动创建并直达。
- 人类员工/高管需先绑定专属助理 Agent，未绑定账号不可发起或参与会议。
- 人类发起会议时，主持人会自动切换为其专属助理（人类本人不加入会议参与者）。
- 人类在会议输入消息时，系统会自动以其专属助理身份发送。
- 人类登录后若未绑定专属助理，会收到阻断式引导；点击“创建专属助理”可一键创建并绑定。
- 未开始会议支持直接删除。
- 会议列表中的任意会议支持单独新开页面（`/meetings/:meetingId`，不显示全局菜单和会议列表，保留聊天区与会议操作区）。
- 聊天输入支持 `@成员` 提示下拉，可键盘选择并插入 mention。
- 会议详情新增右侧操作区，可修改会议名称与管理参会人员。
- 当 1 对 1 会议新增非系统内置（非隐形）Agent 扩展为多人讨论时，会议名称会自动调整为多人讨论语义。
- 在会议中输入“搜索最新openai模型”时，会优先触发 `Model Management Agent` 联网搜索。
- 该 Agent 会先返回候选模型列表，并询问是否添加到系统；确认前不写入。
- 在会议中询问“现在系统里有哪些模型”时，会优先触发 `Model Management Agent` 返回实时模型清单。
- 专属助理不会主动发言，仅在其对应人类显式 `@` 助理时响应。

#### 研发管理 (`/api/rd-management`)
- `GET /opencode/current` - 获取当前 OpenCode session 和 project 上下文
- `GET /opencode/projects` - 获取 OpenCode 已有项目列表
- `POST /opencode/projects/import` - 导入 OpenCode 项目（含 sessions/events 快照）到研发管理
- `GET /opencode/sessions` - 获取 OpenCode 已有 session 列表
- `GET /opencode/sessions/:id` - 获取 session 详情
- `GET /opencode/sessions/:id/messages` - 获取 session 消息时间线
- `POST /opencode/sessions` - 创建新的 OpenCode session
- `POST /opencode/sessions/:id/prompt` - 向指定 session 发送消息
- `GET /opencode/events?token=<JWT>` - 订阅 OpenCode 实时事件（SSE）
- `POST /tasks/:id/opencode/sync-current` - 同步当前 OpenCode session/project 到任务
- `POST /projects/:id/opencode/sync-current` - 同步当前 OpenCode project/session 到项目

#### 任务编排与 Session 管理 (`/api/orchestration`)
- `POST /plans/from-prompt` - 通过一句提示词生成可执行计划与任务拆解
- `GET /plans` - 获取编排计划列表
- `GET /plans/:id` - 获取计划详情（含任务）
- `POST /plans/:id/run` - 执行计划（支持串行/并行）
- `POST /tasks/:id/reassign` - 任务改派（Agent/员工/未分配）
- `POST /tasks/:id/complete-human` - 人工任务完成回填
- `POST /sessions` - 创建会话
- `GET /sessions` - 查询会话（可按 ownerType/status 过滤）
- `POST /sessions/:id/messages` - 向会话追加消息
- `POST /sessions/:id/archive` - 归档会话
- `POST /sessions/:id/resume` - 恢复会话

#### 统一消息 (`/api/messages`)
- `GET /` - 按 `sceneType + sceneId` 分页查询消息（支持 `limit`、`before`）

## 📊 数据模型

### 核心实体关系

```
Organization (组织)
├── ShareDistribution (股权分配)
├── AgentRole[] (角色定义)
├── AgentEmployee[] (员工记录)
└── Department[] (部门)

Agent (AI代理)
├── AIModel (模型配置)
├── Tool[] (工具权限)
├── Permission[] (权限)
└── Personality (个性特征)

Proposal (提案)
├── Vote[] (投票记录)
└── ExecutionHistory (执行历史)

Task (任务)
├── Discussion (任务讨论)
└── ToolExecution[] (工具执行)

Meeting (会议)
├── Participant[] (参与者)
└── Summary (会议总结)

Messages (统一消息)
├── sceneType + sceneId (场景定位)
├── senderType + senderId (发送者定位)
└── metadata/model/tokens/latency/cost (评测与分析字段)
```

### 关键数据字段

#### Agent个性特征
```typescript
interface Personality {
  workEthic: number;      // 工作伦理 0-100
  creativity: number;     // 创造力 0-100
  leadership: number;     // 领导力 0-100
  teamwork: number;       // 团队协作 0-100
}
```

#### 绩效KPI
```typescript
interface KPIs {
  taskCompletionRate: number;  // 任务完成率
  codeQuality: number;        // 代码质量
  collaboration: number;      // 团队协作
  innovation: number;         // 创新能力
  efficiency: number;         // 工作效率
}
```

## 🛠️ 开发指南

### 项目结构
```
ai-agent-team-platform/
├── backend/                 # Nest.js 后端服务
│   ├── src/
│   │   ├── modules/        # 业务模块
│   │   │   ├── agents/     # Agent管理
│   │   │   ├── tools/      # 工具系统
│   │   │   ├── organization/ # 组织管理
│   │   │   ├── hr/         # 人力资源
│   │   │   ├── governance/ # 公司治理
│   │   │   ├── tasks/      # 任务管理
│   │   │   └── chat/       # 讨论协作
│   │   ├── shared/         # 共享组件
│   │   │   └── schemas/   # 数据模型
│   │   └── config/         # 配置文件
│   └── package.json
├── frontend/               # React 前端应用
│   ├── src/
│   │   ├── components/     # UI组件
│   │   ├── pages/         # 页面组件
│   │   ├── services/      # API服务
│   │   ├── stores/        # 状态管理
│   │   ├── types/         # 类型定义
│   │   └── utils/         # 工具函数
│   └── package.json
├── shared/                # 共享类型
└── docs/                 # 项目文档
```

### 开发命令
```bash
# 开发环境启动
npm run dev

# 仅启动后端
npm run dev:backend

# 仅启动前端
npm run dev:frontend

# 构建项目
npm run build

# 运行测试
npm run test
```

### 环境变量配置

#### 后端配置 (.env.development)
```env
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/ai-agent-team

# 微服务端口
GATEWAY_PORT=3100
AGENTS_PORT=3002
WS_PORT=3003

# 服务路由
AGENTS_SERVICE_URL=http://localhost:3002
LEGACY_SERVICE_URL=http://localhost:3001
INTERNAL_CONTEXT_SECRET=replace_with_strong_internal_secret

# Redis
REDIS_URL=redis://127.0.0.1:6379

# AI模型API密钥
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_claude_key_here
GOOGLE_AI_API_KEY=your_gemini_key_here
MOONSHOT_API_KEY=your_kimi_key_here

# 可选：当本机无法直连模型服务时使用代理
AI_PROXY_URL=http://127.0.0.1:7890

# JWT配置
JWT_SECRET=your_development_jwt_secret_here
JWT_EXPIRES_IN=7d

# 前端地址
FRONTEND_URL=http://localhost:3000

# OpenCode SDK Server
OPENCODE_SERVER_URL=http://localhost:4096
```

#### 微服务启动（平滑迁移）

```bash
# 终端1：legacy monolith（未迁移模块）
npm run start:dev

# 终端2：agents service（已拆分）
npm run start:agents:dev

# 终端3：gateway（统一入口）
npm run start:gateway:dev

# 终端4：ws service（流式推送）
npm run start:ws:dev
```

- 前端 HTTP 统一走 Gateway: `http://localhost:3100/api`
- 前端 WS 连接: `ws://localhost:3003/ws`

## 🔧 扩展开发

### 添加新工具
1. 在`ToolService`中添加工具实现
2. 定义工具参数和权限
3. 更新工具执行逻辑
4. 在前端添加工具界面

### 自定义Agent角色
1. 修改`OrganizationService`中的角色定义
2. 设置薪资范围和期权分配
3. 配置所需工具和能力
4. 更新前端角色管理界面

### 扩展投票类型
1. 在`Proposal`类型中添加新的提案类型
2. 实现对应的执行逻辑
3. 更新前端提案创建表单
4. 添加相应的投票处理

## 🚀 部署指南

### Docker部署
```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d
```

### 生产环境配置
1. 使用生产环境变量配置
2. 启用HTTPS
3. 配置负载均衡
4. 设置监控和日志

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 创建Pull Request

## 📄 许可证

MIT License

## 🙏 致谢

感谢所有为这个项目做出贡献的开发者和AI模型提供商。

---

**🚀 开始你的AI创业之旅！**


$ lsof -ti :3001 | xargs kill -9 2>/dev/null


$ (lsof -ti :3001; lsof -ti :3002; lsof -ti :3003; lsof -ti :3100) 2>/dev/null | sort -u | xargs -r kill; sleep 2; nohup npm run start:dev > /tmp/legacy-app.log 2>&1 & nohup npm run start:agents:dev > /tmp/agents-app.log 2>&1 & nohup npm run start:gateway:dev > /tmp/gateway-app.log 2>&1 & nohup npm run start:ws:dev > /tmp/ws-app.log 2>&1 & sleep 8; lsof -nP -i :3001 -i :3002 -i :3003 -i :3100 | grep LISTEN
