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
- Redis >= 7.0
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

3. **配置环境变量**
```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env，配置数据库密码和AI模型API密钥
```

4. **启动数据库服务**
```bash
# 方式一：使用 Docker Compose（推荐）
docker-compose up -d

# 方式二：手动启动
mongod
redis-server
```

5. **启动项目**
```bash
# 方式一：使用启动脚本（推荐）
./start.sh development

# 方式二：手动逐个启动
cd backend
pnpm run start:dev       # legacy (3001)
pnpm run start:gateway:dev  # gateway (3100)
pnpm run start:agents:dev   # agents (3002)
pnpm run start:ws:dev       # ws (3003)
pnpm run start:ei:dev       # engineering-intelligence (3201)

cd ../frontend
pnpm dev  # frontend (3000)
```

6. **访问应用**
- 前端界面: http://localhost:3000
- 后端API: http://localhost:3001

### 服务端口一览

| 服务 | 端口 | 说明 | 启动命令 |
|------|------|------|----------|
| Frontend | 3000 | 前端界面 | `cd frontend && pnpm dev` |
| Legacy | 3001 | 主服务（未拆分模块） | `cd backend && pnpm run start:dev` |
| Agents | 3002 | Agent管理服务 | `cd backend && pnpm run start:agents:dev` |
| WS | 3003 | WebSocket服务 | `cd backend && pnpm run start:ws:dev` |
| Gateway | 3100 | API网关入口 | `cd backend && pnpm run start:gateway:dev` |
| Engineering Intelligence | 3201 | 研发智能服务 | `cd backend && pnpm run start:ei:dev` |
| MongoDB | 27017 | 数据库 | `docker-compose up -d mongodb` |
| Redis | 6379 | 缓存 | `docker-compose up -d redis` |

**注意**：
- 前端通过 Gateway (3100) 访问后端API
- WebSocket 连接地址: `ws://localhost:3003/ws`

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

系统功能模块详见 `docs/features/INDEX.md`，主要包括：
- Agent 管理
- 任务编排
- 会议协作
- 工程智能
- HR 管理
- 网关/API管理

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
# 开发环境启动（使用脚本，推荐）
./start.sh development

# 手动启动所有后端服务
cd backend
pnpm run start:dev        # legacy (3001)
pnpm run start:gateway:dev # gateway (3100)
pnpm run start:agents:dev  # agents (3002)
pnpm run start:ws:dev      # ws (3003)
pnpm run start:ei:dev      # engineering-intelligence (3201)

# 启动前端
cd ../frontend
pnpm dev  # 端口 3000

# 构建项目
npm run build

# 运行测试
npm run test
```

### 环境变量配置

#### 微服务启动

```bash
# 终端1：legacy monolith（未迁移模块）- 端口 3001
cd backend && pnpm run start:dev

# 终端2：agents service（已拆分）- 端口 3002
cd backend && pnpm run start:agents:dev

# 终端3：gateway（统一入口）- 端口 3100
cd backend && pnpm run start:gateway:dev

# 终端4：ws service（流式推送）- 端口 3003
cd backend && pnpm run start:ws:dev

# 终端5：engineering-intelligence（研发智能）- 端口 3201
cd backend && pnpm run start:ei:dev

# 终端6：frontend - 端口 3000
cd frontend && pnpm dev
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

详细部署流程请参考：[生产环境部署指南](docs/PRODUCTION_DEPLOYMENT.md)

### Docker部署（推荐）
```bash
# 启动数据库服务（MongoDB + Redis）
docker-compose up -d

# 构建并启动所有服务
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 手动部署
```bash
# 启动 MongoDB
mongod --dbpath /data/db

# 启动 Redis
redis-server

# 启动后端服务
cd backend && pnpm run start:prod

# 启动前端
cd frontend && pnpm build && pnpm preview
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
