# AI Agent Team Platform

一个创新的AI Agent创业公司模拟平台，支持多模型接入的Agent团队协作管理，模拟真实组织架构、成本核算、人力资源和决策治理。

## 终极目标
- 系统将自我进化成更高效率、更高性价比的多agent协作团队，系统将有agent在日常工作中迭代完善完成自身能力；
- 系统区别于当前火爆的只满足单个人类Agent平台，系统支持多个人类员工+多agent合作；
- 系统通过长期运行，最终会进化出一批在各种任务中表现优异的agent；

## 🌟 核心特色

- 🤖 **多AI模型集成** - 支持OpenAI、Claude、Gemini、Kimi等主流模型
- 👥 **智能Agent管理** - 个性化配置、工具权限、绩效评估
- 💼 **HR管理系统** - 自动绩效评估、团队健康度分析、招聘建议
- 🛠️ **工具生态** - 代码执行、网络搜索、数据分析等多种工具
- 🎥 **会议室系统** - 通过会议形式推进日常工作及协作
- 🧭 **计划编排与会话中台** - 一句话生成执行计划，支持 Agent/Human 分派与统一 Session 管理
- 🧠 **Skill 管理中台** - AgentSkillManager 自动检索技能、给 Agent 提供能力增强建议，并同步 DB+Markdown
- 📝 **Memo 长期记忆** - Agent 通过 Memo MCP 记录行为与知识，支持 TODO 备忘录与渐进检索
- 📚 **研发智能** - 感知现有系统功能及状态，提出优化需求，并下发研发任务

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

#### 预置核心角色
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
| Code Docs MCP | 基于仓库 docs 盘点核心功能并附证据路径 | 4 | Basic（仅CTO默认可用） |
| Code Updates MCP | 基于最近提交汇总时间窗口内主要更新 | 4 | Basic（仅CTO默认可用） |
| Model MCP List Models | 查询系统模型清单 | 3 | Basic |
| Model MCP Search Latest | 互联网检索最新模型候选 | 8 | Basic |
| Model MCP Add Model | 模型入库（含去重） | 5 | Admin |
| Memo MCP Search | 检索 Agent 备忘录（渐进摘要/详情） | 2 | Basic |
| Memo MCP Append | 追加 Agent 备忘录（知识/行为/TODO） | 3 | Basic |
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

#### Agent Memo 长期记忆
- 运行时行为事件先写入 Redis（`memo:event:{agentId}`），避免对话过程产生大量碎片文档
- 后端定时聚合事件并更新长期主题文档（identity / todo / topic）
- 每个 Agent 默认维护两份固定文档：`身份与职责`、`TODO List`
- 专题知识（如系统状态、部门进度）聚合到 `topic-*.md` 文档，便于持续沉淀与检索
- 前端备忘录页面默认只读查询，并提供“备忘录测试”右侧抽屉用于对话触发与持续监测

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

API 已按微服务拆分，详细接口请查看：

- `docs/api/API.md`（API 总览索引）
- `docs/api/gateway-api.md`
- `docs/api/agents-api.md`
- `docs/api/legacy-api.md`
- `docs/api/engineering-intelligence-api.md`
- `docs/api/ws-api.md`


## 🛠️ 开发指南

### 项目架构

- 架构总览与当前微服务边界请参考：`docs/architecture/ARCHITECTURE.md`
- 微服务迁移细节与路由分流请参考：`docs/architecture/MICROSERVICES_MIGRATION.md`

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
2. 设置薪资范围和职责范围
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
