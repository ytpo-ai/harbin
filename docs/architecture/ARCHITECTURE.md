# 架构设计文档

## 🏗️ 系统架构概览

AI Agent Team Platform 采用分层架构设计，实现了前后端分离、模块化开发、可扩展性强。

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层 (Frontend)                     │
│  React + TypeScript + Tailwind CSS + React Query + Zustand  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/REST API
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        网关层 (API Gateway)                  │
│  Nest.js + Express + CORS + Validation Pipe                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐   ┌────────────────┐   ┌──────────────────┐
│   业务模块    │   │    共享模块     │   │    基础设施      │
│  (Modules)   │   │   (Shared)    │   │  (Infrastructure)│
└──────────────┘   └────────────────┘   └──────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      数据层 (Data Layer)                     │
│              MongoDB + Mongoose ODM                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      AI服务层 (AI Layer)                     │
│  OpenAI | Claude | Gemini | DeepSeek | Mistral | Llama...  │
└─────────────────────────────────────────────────────────────┘
```

## 🧭 微服务迁移架构（v2）

为实现平滑迁移，后端升级为 Nest Monorepo 多应用架构，前端统一走 Gateway。

```
backend/
├── apps/
│   ├── gateway/      # 统一入口：鉴权 + 请求分发
│   ├── agents/       # Agent/Task 业务与模型执行
│   ├── ws/           # WebSocket 流式推送
│   └── legacy/       # 未迁移模块（兼容保留）
├── libs/
│   ├── contracts/    # DTO/事件协议
│   ├── auth/         # JWT校验、上下文签名
│   ├── common/       # 通用日志/错误/工具
│   └── infra/        # Redis等基础设施封装
└── src/              # legacy 业务代码
```

### 请求链路

1. 前端 HTTP -> `gateway`（`/api/*`）
2. `gateway` 进行 JWT 鉴权，生成并签名 `x-user-context`
3. `gateway` 按路由分发：
   - `/api/agents`、`/api/tasks` -> `agents`
   - 其他 -> `legacy`
4. `agents` 校验 `x-user-context` 签名后执行业务
5. 流式场景：`agents` 发布 Redis 事件，`ws` 订阅并推送前端

### 安全模型（Gateway -> Service）

- 下游服务不再信任前端自带身份头。
- 身份由 Gateway 提取后签名传递：
  - `x-user-context`: base64url(userContext)
  - `x-user-signature`: HMAC-SHA256(context)
- `agents` 使用 `INTERNAL_CONTEXT_SECRET` 验签，防止伪造头。

## 📦 后端架构

### 技术栈
- **框架**: Nest.js 10.x
- **语言**: TypeScript 5.x
- **数据库**: MongoDB 6.x + Mongoose 8.x
- **API风格**: RESTful + Swagger文档
- **认证**: JWT (预留)
- **日志**: Nest.js Logger

### 模块结构

```
backend/src/
├── modules/                    # 业务模块
│   ├── agents/                # Agent管理模块
│   │   ├── agent.controller.ts
│   │   ├── agent.service.ts
│   │   └── agent.module.ts
│   │
│   ├── models/                # AI模型模块
│   │   ├── model.controller.ts
│   │   ├── model.service.ts
│   │   ├── model-management.controller.ts
│   │   ├── model-management.service.ts
│   │   ├── base-provider.ts
│   │   ├── openai-provider.ts
│   │   ├── anthropic-provider.ts
│   │   ├── google-provider.ts
│   │   └── model.module.ts
│   │
│   ├── tools/                 # 工具系统模块
│   │   ├── tool.controller.ts
│   │   ├── tool.service.ts
│   │   └── tool.module.ts
│   │
│   ├── organization/          # 组织管理模块
│   │   ├── organization.controller.ts
│   │   ├── organization.service.ts
│   │   └── organization.module.ts
│   │
│   ├── hr/                    # 人力资源模块
│   │   ├── hr.controller.ts
│   │   ├── hr.service.ts
│   │   └── hr.module.ts
│   │
│   ├── governance/            # 公司治理模块
│   │   ├── governance.controller.ts
│   │   ├── governance.service.ts
│   │   └── governance.module.ts
│   │
│   ├── tasks/                 # 任务管理模块
│   │   ├── task.controller.ts
│   │   ├── task.service.ts
│   │   └── task.module.ts
│   │
│   └── chat/                  # 讨论协作模块
│       ├── discussion.controller.ts
│       ├── discussion.service.ts
│       └── chat.module.ts
│
├── shared/                    # 共享资源
│   ├── schemas/              # Mongoose Schema
│   │   ├── agent.schema.ts
│   │   ├── task.schema.ts
│   │   ├── tool.schema.ts
│   │   ├── organization.schema.ts
│   │   ├── proposal.schema.ts
│   │   └── toolExecution.schema.ts
│   └──
│
├── config/                   # 配置文件
│   ├── app.config.ts
│   ├── database.config.ts
│   ├── ai.config.ts
│   ├── jwt.config.ts
│   └── models.ts            # 50个模型配置
│
└── main.ts                  # 应用入口
```

### 核心设计模式

#### 1. 依赖注入 (Dependency Injection)
```typescript
@Injectable()
export class AgentService {
  constructor(
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    private readonly modelService: ModelService
  ) {}
}
```

#### 2. 提供者模式 (Provider Pattern)
```typescript
// BaseAIProvider - 抽象基类
export abstract class BaseAIProvider {
  abstract chat(messages: ChatMessage[], options?: any): Promise<string>;
  abstract streamingChat(messages: ChatMessage[], onToken: (token: string) => void, options?: any): Promise<void>;
}

// 具体实现
export class OpenAIProvider extends BaseAIProvider { ... }
export class AnthropicProvider extends BaseAIProvider { ... }
```

#### 3. 模块系统 (Module System)
```typescript
@Module({
  imports: [MongooseModule.forFeature([...])],
  controllers: [...],
  providers: [...],
  exports: [...]
})
export class AgentModule {}
```

## 🎨 前端架构

### 技术栈
- **框架**: React 18.x
- **语言**: TypeScript 5.x
- **样式**: Tailwind CSS 3.x
- **状态管理**: Zustand 4.x
- **数据获取**: React Query 3.x
- **路由**: React Router 6.x
- **UI组件**: Headless UI + Heroicons
- **构建工具**: Vite 4.x

### 目录结构

```
frontend/src/
├── components/               # 共享组件
│   └── Layout.tsx           # 布局组件
│
├── pages/                   # 页面组件
│   ├── Dashboard.tsx
│   ├── Models.tsx
│   ├── Organization.tsx
│   ├── Agents.tsx
│   ├── Tasks.tsx
│   ├── Tools.tsx
│   ├── HRManagement.tsx
│   ├── Governance.tsx
│   └── Discussions.tsx
│
├── services/                # API服务
│   ├── api.ts              # Axios配置
│   ├── agentService.ts
│   ├── modelService.ts
│   ├── toolService.ts
│   ├── organizationService.ts
│   ├── hrService.ts
│   ├── governanceService.ts
│   └── taskService.ts
│
├── stores/                  # 状态管理
│   ├── agentStore.ts
│   ├── taskStore.ts
│   └── organizationStore.ts
│
├── types/                   # 类型定义
│   └── index.ts
│
└── utils/                   # 工具函数
    └── ...
```

### 状态管理

#### Zustand Store 示例
```typescript
interface AgentStore {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  loading: false,
  error: null,
  setAgents: (agents) => set({ agents }),
  // ...
}));
```

## 🗄️ 数据架构

### 数据库设计

#### 核心集合
1. **agents** - Agent信息
2. **tasks** - 任务数据
3. **discussions** - 讨论记录
4. **organizations** - 组织架构
5. **tools** - 工具配置
6. **proposals** - 提案数据
7. **toolExecutions** - 工具执行记录

### 数据关系

```
Organization
├── ShareDistribution
├── AgentRole[]
├── AgentEmployee[] (引用 Agent)
└── Department[]

Agent
├── AIModel (嵌入)
├── Tool[] (引用)
└── Permission[] (嵌入)

Task
├── Discussion (可选)
└── ToolExecution[] (引用)

Proposal
└── Vote[] (嵌入)
```

## 🔌 API架构

### RESTful API设计

```
/api/agents
├── GET    /           - 获取所有Agent
├── POST   /           - 创建Agent
├── GET    /:id        - 获取单个Agent
├── PUT    /:id        - 更新Agent
├── DELETE /:id        - 删除Agent
└── POST   /:id/execute - 执行Agent任务

/api/models
├── GET    /                    - 获取所有模型
├── POST   /:id/chat            - 聊天接口
├── GET    /debug/status        - 调试状态
└── POST   /:id/test            - 测试模型

/api/model-management
├── GET    /available           - 可用模型列表
├── GET    /recommended         - 推荐模型
├── GET    /by-provider/:provider - 按提供商筛选
├── POST   /select-for-founder/:type - 选择创始人模型
└── GET    /founder-models      - 获取创始人模型

/api/organization
├── POST   /initialize          - 初始化组织
├── GET    /                    - 获取组织信息
├── POST   /hire                - 雇佣Agent
├── POST   /fire                - 解雇Agent
└── GET    /stats               - 组织统计

/api/tools
├── GET    /                    - 获取所有工具
├── POST   /:id/execute         - 执行工具
└── GET    /executions/history  - 执行历史

/api/hr
├── GET    /performance/:id     - 绩效报告
├── GET    /low-performers      - 低绩效员工
└── GET    /hiring-recommendations - 招聘建议

/api/governance
├── POST   /proposals           - 创建提案
├── GET    /proposals           - 获取提案列表
└── POST   /proposals/:id/vote  - 投票
```

## 🔧 扩展架构

### 添加新模型提供商

1. **创建Provider类**
```typescript
// src/modules/models/new-provider.ts
export class NewProvider extends BaseAIProvider {
  async chat(messages, options) {
    // 实现API调用
  }
}
```

2. **注册Provider**
```typescript
// model.service.ts
switch (model.provider) {
  case 'newprovider':
    provider = new NewProvider(model);
    break;
}
```

3. **更新类型定义**
```typescript
// types.ts
provider: 'openai' | 'anthropic' | ... | 'newprovider';
```

### 添加新工具类型

1. **定义工具Schema**
2. **实现工具执行逻辑**
3. **注册到ToolService**
4. **添加前端界面**

## 🔒 安全架构

### 当前安全措施
- CORS跨域配置
- 输入验证 (ValidationPipe)
- API密钥环境变量管理

### 预留安全功能
- JWT认证
- 请求限流
- 操作审计日志

## 📊 性能优化

### 后端优化
- 数据库索引优化
- 查询缓存
- 异步处理

### 前端优化
- React Query缓存
- 组件懒加载
- 虚拟滚动 (大数据列表)

## 🚀 部署架构

### 开发环境
```
MongoDB (本地) → Backend (localhost:3001) → Frontend (localhost:3000)
```

### 生产环境 (推荐)
```
MongoDB Atlas
      ↓
Backend (Docker Container)
      ↓
Frontend (Static Files / CDN)
      ↓
Nginx (Reverse Proxy + SSL)
```

---

**架构版本**: v1.0
**最后更新**: 2026-02-25
