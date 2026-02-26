# AI Agent Team Platform

一个创新的AI Agent创业公司模拟平台，支持多模型接入的Agent团队协作管理，模拟真实公司的组织架构、股权分配、人力资源和决策治理。

## 🌟 核心特色

- 🏢 **完整的公司架构模拟** - 股权分配、角色体系、部门结构
- 🤖 **多AI模型集成** - 支持OpenAI、Claude、Gemini等主流模型
- 👥 **智能Agent管理** - 个性化配置、工具权限、绩效评估
- 🗳️ **民主决策系统** - 基于股份的投票机制和提案管理
- 💼 **HR管理系统** - 自动绩效评估、团队健康度分析、招聘建议
- 🛠️ **工具生态** - 代码执行、网络搜索、数据分析等多种工具
- 📈 **动态扩张** - 智能招聘建议、组织结构调整
- 🎥 **会议室系统** - 支持7种会议类型，AI Agent真实参与讨论

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
- **AI模型**: OpenAI, Anthropic Claude, Google Gemini
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

### 1. 🏢 组织管理

#### 股权结构
- **创始人股权**: 你(人类)占75%决定权
- **联合创始人**: 2个创始Agent共享15%股份
- **员工期权池**: 10%股份用于未来员工激励

#### 角色体系
| 角色 | 级别 | 部门 | 薪资范围 | 期权 |
|------|------|------|----------|------|
| CEO | 执行官 | 管理 | ¥10K-15K | 100K股 |
| CTO | 执行官 | 技术 | ¥12K-18K | 80K股 |
| 高级开发工程师 | 资深 | 技术 | ¥8K-12K | 20K股 |
| 初级开发工程师 | 初级 | 技术 | ¥4K-6K | 5K股 |
| 数据分析师 | 资深 | 数据 | ¥6K-9K | 15K股 |
| 产品经理 | 资深 | 产品 | ¥7K-10K | 20K股 |
| HR经理 | 管理 | 人力 | ¥5K-8K | 10K股 |
| 视频编辑师 | 资深 | 创意 | ¥5K-8K | 10K股 |

#### 部门设置
- **管理部**: CEO负责，预算¥50K
- **技术部**: CTO负责，预算¥200K
- **数据部**: 数据分析，预算¥80K
- **产品部**: 产品规划，预算¥60K
- **人力部**: HR管理，预算¥40K
- **创意部**: 内容创作，预算¥60K

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
- AI模型选择(OpenAI/Claude/Gemini)
- 系统提示定制
- 能力标签配置
- 工具权限分配
- 激活状态管理

### 3. 🛠️ 工具系统

#### 工具类型
| 工具类型 | 功能描述 | Token成本 | 权限要求 |
|----------|----------|------------|----------|
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

### 5. 🗳️ 公司治理系统

#### 提案类型
- **招聘提案**: 雇佣新Agent成员
- **解雇提案**: 终止低绩效Agent
- **工具权限**: 工具访问权限申请
- **战略决策**: 公司发展方向决策
- **预算调整**: 部门预算变更
- **政策制定**: 公司规章制度

#### 投票机制
- **股份加权投票**: 基于股份比例的投票权重
- **法定人数要求**: 需要至少51%股份参与
- **通过门槛**: 需要60%同意票才能通过
- **投票期限**: 24小时投票时间窗口

#### 自动执行
- 通过提案自动执行
- 投票结果实时统计
- 决策历史记录
- 执行状态跟踪

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

#### 组织管理 (`/api/organization`)
- `POST /initialize` - 初始化组织
- `GET /` - 获取组织信息
- `POST /hire` - 雇佣Agent
- `POST /fire` - 解雇Agent
- `GET /stats` - 组织统计数据

#### Agent管理 (`/api/agents`)
- `GET /` - 获取所有Agent
- `POST /` - 创建新Agent
- `PUT /:id` - 更新Agent信息
- `DELETE /:id` - 删除Agent
- `POST /:id/execute` - 执行Agent任务

#### 工具管理 (`/api/tools`)
- `GET /` - 获取所有工具
- `POST /:id/execute` - 执行工具
- `GET /executions/history` - 执行历史
- `GET /executions/stats` - 执行统计

#### 人力资源 (`/api/hr`)
- `GET /performance/:agentId` - 绩效报告
- `GET /low-performers` - 低绩效员工
- `GET /hiring-recommendations` - 招聘建议
- `GET /team-health` - 团队健康度

#### 公司治理 (`/api/governance`)
- `POST /proposals` - 创建提案
- `GET /proposals` - 获取提案列表
- `POST /proposals/:id/vote` - 投票
- `GET /proposals/:id/summary` - 投票汇总

#### 会议室系统 (`/api/meetings`)
- `POST /` - 创建会议
- `POST /:id/start` - 开始会议
- `POST /:id/end` - 结束会议
- `POST /:id/join` - 加入会议
- `POST /:id/leave` - 离开会议
- `POST /:id/messages` - 发送消息
- `POST /:id/invite` - 邀请Agent
- `GET /` - 获取会议列表
- `GET /stats` - 获取统计信息

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
├── Message[] (消息记录)
└── Summary (会议总结)
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

# AI模型API密钥
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_claude_key_here
GOOGLE_AI_API_KEY=your_gemini_key_here

# 可选：当本机无法直连模型服务时使用代理
AI_PROXY_URL=http://127.0.0.1:7890

# JWT配置
JWT_SECRET=your_development_jwt_secret_here
JWT_EXPIRES_IN=7d

# 前端地址
FRONTEND_URL=http://localhost:3000
```

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