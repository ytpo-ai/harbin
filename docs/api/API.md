# API 文档

## 基础信息

- **Base URL**: `http://localhost:3001/api`
- **Content-Type**: `application/json`
- **响应格式**: JSON

## 认证

当前版本未启用认证，后续版本将支持 JWT Token。

---

## 1. Agent 管理 API

### 1.1 获取所有Agent
```http
GET /agents
```

**响应示例**:
```json
[
  {
    "id": "65d123...",
    "name": "Alex Chen",
    "type": "ai-executive",
    "description": "CEO of the company",
    "model": {
      "id": "claude-sonnet-4-6",
      "name": "Claude Sonnet 4.6",
      "provider": "anthropic"
    },
    "isActive": true,
    "capabilities": ["战略思维", "领导力"]
  }
]
```

### 1.2 创建Agent
```http
POST /agents
```

**请求体**:
```json
{
  "name": "New Agent",
  "type": "ai-developer",
  "description": "A new AI developer",
  "model": {
    "id": "gpt-4-turbo",
    "name": "GPT-4 Turbo",
    "provider": "openai",
    "model": "gpt-4-turbo-preview",
    "maxTokens": 4096
  },
  "capabilities": ["编程", "代码审查"],
  "systemPrompt": "You are a helpful AI developer...",
  "isActive": true
}
```

### 1.3 执行Agent任务
```http
POST /agents/:id/execute
```

**请求体**:
```json
{
  "task": {
    "title": "Task Title",
    "description": "Task Description",
    "type": "development",
    "priority": "high",
    "messages": [
      {
        "role": "user",
        "content": "Please write a hello world program",
        "timestamp": "2026-02-25T10:00:00Z"
      }
    ]
  }
}
```

**响应**:
```json
{
  "response": "Here's a hello world program in Python:\n\nprint('Hello, World!')"
}
```

### 1.4 测试Agent连接
```http
POST /agents/:id/test
```

**响应**:
```json
{
  "success": true,
  "agent": "Alex Chen",
  "model": "Claude Sonnet 4.6",
  "response": "Agent Connected to AI Model Successfully",
  "duration": "1250ms"
}
```

---

## 1.5 会议 API（Meetings）

### 获取会议列表
```http
GET /meetings
```

### 发送会议消息
```http
POST /meetings/:id/messages
```

当消息内容包含 `@AgentName` 时，仅被 @ 的在场 Agent 会响应；
不包含 @ 时，默认所有在场 Agent 依次响应。

### 暂停会议
```http
POST /meetings/:id/pause
```

### 恢复会议
```http
POST /meetings/:id/resume
```

### 切换发言模式
```http
PUT /meetings/:id/speaking-mode
```

**请求体**:
```json
{
  "speakingOrder": "free"
}
```

`speakingOrder` 可选值:
- `free`: 自由讨论
- `ordered`: 有序发言（Agent发言后需等待人类下一次发言）

### 实时会议事件（WebSocket）
- WS 地址: `ws://localhost:3003/ws`
- 订阅频道: `meeting:<meetingId>`
- 事件类型: `message` / `status_changed` / `participant_joined` / `participant_left` / `summary_generated` / `settings_changed`

---

## 2. 模型管理 API

### 2.1 获取所有可用模型
```http
GET /models
```

### 2.2 获取模型调试状态
```http
GET /models/debug/status
```

**响应**:
```json
{
  "registeredModels": 3,
  "models": [
    {
      "id": "gpt-4-turbo",
      "name": "GPT-4 Turbo",
      "provider": "openai"
    }
  ]
}
```

### 2.3 测试模型连接
```http
POST /models/:modelId/test
```

### 2.4 聊天接口
```http
POST /models/:modelId/chat
```

**请求体**:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "options": {
    "temperature": 0.7,
    "maxTokens": 1000
  }
}
```

---

## 3. 模型选择 API

### 3.1 获取所有可用模型列表
```http
GET /model-management/available
```

**响应** (50个模型):
```json
[
  {
    "id": "gpt-4-turbo",
    "name": "GPT-4 Turbo",
    "provider": "openai",
    "model": "gpt-4-turbo-preview",
    "maxTokens": 4096,
    "temperature": 0.7
  }
]
```

### 3.2 获取推荐模型
```http
GET /model-management/recommended
```

### 3.3 按提供商获取模型
```http
GET /model-management/by-provider/:provider
```

**示例**: `/model-management/by-provider/openai`

### 3.4 为创始人选择模型
```http
POST /model-management/select-for-founder/:founderType
```

**参数**:
- `founderType`: `ceo` 或 `cto`

**请求体**:
```json
{
  "modelId": "gpt-4-turbo"
}
```

**响应**:
```json
{
  "success": true,
  "message": "CEO model updated successfully",
  "model": {
    "id": "gpt-4-turbo",
    "name": "GPT-4 Turbo"
  }
}
```

### 3.5 获取当前创始人模型
```http
GET /model-management/founder-models
```

**响应**:
```json
{
  "ceo": {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6"
  },
  "cto": {
    "id": "gpt-4-turbo",
    "name": "GPT-4 Turbo"
  }
}
```

---

## 4. 组织管理 API

### 4.1 初始化组织
```http
POST /organization/initialize
```

**响应**:
```json
{
  "id": "org-uuid",
  "name": "AI Agent Team Ltd.",
  "shareDistribution": {
    "founder": { "percentage": 75 },
    "cofounders": [{ "percentage": 7.5 }],
    "employeePool": { "percentage": 10 }
  }
}
```

### 4.2 获取组织信息
```http
GET /organization
```

### 4.3 雇佣Agent
```http
POST /organization/hire
```

**请求体**:
```json
{
  "agentId": "agent-uuid",
  "roleId": "senior-developer",
  "proposerId": "human-founder"
}
```

### 4.4 解雇Agent
```http
POST /organization/fire
```

**请求体**:
```json
{
  "agentId": "agent-uuid",
  "reason": "Performance issues"
}
```

### 4.5 获取组织统计
```http
GET /organization/stats
```

**响应**:
```json
{
  "totalEmployees": 10,
  "activeEmployees": 8,
  "monthlyPayroll": 85000,
  "companyValuation": 1000000
}
```

---

## 5. 工具管理 API

### 5.1 获取所有工具
```http
GET /tools
```

### 5.2 执行工具
```http
POST /tools/:toolId/execute
```

**请求体**:
```json
{
  "agentId": "agent-uuid",
  "parameters": {
    "language": "python",
    "code": "print('Hello')"
  },
  "taskId": "task-uuid"
}
```

### 5.3 获取工具执行历史
```http
GET /tools/executions/history
```

**查询参数**:
- `agentId` (可选): 筛选特定Agent
- `toolId` (可选): 筛选特定工具

### 5.4 获取工具统计
```http
GET /tools/executions/stats
```

---

## 6. 人力资源 API

### 6.1 生成绩效报告
```http
GET /hr/performance/:agentId
```

**响应**:
```json
{
  "agentId": "agent-uuid",
  "overallScore": 85,
  "kpis": {
    "taskCompletionRate": 90,
    "codeQuality": 85,
    "collaboration": 88,
    "innovation": 80,
    "efficiency": 82
  },
  "recommendations": ["继续保持", "加强创新"]
}
```

### 6.2 识别低绩效员工
```http
GET /hr/low-performers
```

### 6.3 获取招聘建议
```http
GET /hr/hiring-recommendations
```

### 6.4 计算团队健康度
```http
GET /hr/team-health
```

---

## 7. 公司治理 API

### 7.1 创建提案
```http
POST /governance/proposals
```

**请求体**:
```json
{
  "title": "Hire New Developer",
  "description": "We need to hire a senior developer...",
  "type": "hire",
  "proposerId": "human-founder",
  "metadata": {
    "roleId": "senior-developer"
  }
}
```

### 7.2 获取提案列表
```http
GET /governance/proposals
```

### 7.3 投票
```http
POST /governance/proposals/:id/vote
```

**请求体**:
```json
{
  "voterId": "human-founder",
  "decision": "for",
  "reason": "We really need more developers"
}
```

### 7.4 获取投票汇总
```http
GET /governance/proposals/:id/summary
```

---

## 8. 讨论协作 API

### 8.1 创建讨论
```http
POST /discussions
```

**请求体**:
```json
{
  "taskId": "task-uuid",
  "participantIds": ["agent-1", "agent-2"],
  "initialPrompt": "Let's discuss the architecture"
}
```

### 8.2 发送消息
```http
POST /discussions/:id/messages
```

**请求体**:
```json
{
  "agentId": "agent-uuid",
  "content": "I think we should use microservices",
  "type": "opinion"
}
```

### 8.3 结束讨论
```http
POST /discussions/:id/conclude
```

---

## 错误处理

### 错误响应格式
```json
{
  "statusCode": 400,
  "message": "Agent not found: invalid-id",
  "error": "Bad Request"
}
```

### 常见错误码
- `400` - 请求参数错误
- `404` - 资源不存在
- `500` - 服务器内部错误

---

## 调试接口

### Agent调试状态
```http
GET /agents/debug/status
```

### 组织调试状态
```http
GET /organization/debug/status
```

### 模型调试状态
```http
GET /models/debug/status
```

---

**API版本**: v1.0
**最后更新**: 2026-02-25
