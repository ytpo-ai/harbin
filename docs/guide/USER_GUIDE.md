# 使用指南

## 🚀 快速开始

### 1. 环境准备

**必需软件**:
- Node.js >= 18.0.0
- MongoDB >= 5.0
- npm 或 yarn

**推荐工具**:
- VS Code (编辑器)
- MongoDB Compass (数据库可视化)
- Postman (API测试)

### 2. 项目安装

```bash
# 1. 进入项目目录
cd ytpo-ai

# 2. 安装所有依赖
npm run install:all

# 3. 或者分别安装
cd backend && npm install
cd ../frontend && npm install
```

### 3. 环境配置

**后端配置**:
```bash
cd backend

# 复制环境变量模板
cp .env.example .env.development

# 编辑 .env.development 文件
vim .env.development
```

**必须配置的变量**:
```env
# 数据库
MONGODB_URI=mongodb://localhost:27017/ai-agent-team

# AI模型API密钥 (至少配置一个)
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-your-claude-key
GOOGLE_AI_API_KEY=your-gemini-key

# 可选：网络受限时配置代理
AI_PROXY_URL=http://127.0.0.1:7890

# 可选的其他API密钥
DEEPSEEK_API_KEY=your-deepseek-key
MISTRAL_API_KEY=your-mistral-key
```

### 4. 启动服务

**方式1: 使用启动脚本**
```bash
./backend/start.sh development
```

**方式2: 手动启动**
```bash
# 终端1: 启动MongoDB
mongod

# 终端2: 启动 legacy 服务（未迁移模块）
cd backend
npm run start:legacy -- --watch

# 说明：开发态修改代码后通常会自动生效，不用重启服务；仅在服务报错后再重启对应服务。

# 终端3: 启动 agents 服务
cd backend
npm run start:agents -- --watch

# 终端4: 启动 gateway 服务（前端统一入口）
cd backend
npm run start:gateway -- --watch

# 终端5: 启动 ws 服务（流式推送）
cd backend
npm run start:ws -- --watch

# 终端6: 启动前端
cd frontend
npm run dev
```

### 5. 访问应用

- **前端界面**: http://localhost:3000
- **Gateway API入口**: http://localhost:3100/api
- **Legacy API**: http://localhost:3001/api
- **Agents API**: http://localhost:3002/api
- **WS服务**: ws://localhost:3003/ws

---

## 📋 使用流程

### 第一步: 配置AI模型

1. **访问模型管理页面**
   - 点击左侧导航"模型管理"

2. **为核心角色选择模型**
   - CEO推荐: Claude Opus 4.6, GPT-4 Turbo, GPT-4o
   - CTO推荐: Claude Sonnet 4.6, GPT-4 Turbo

3. **保存设置**
   - 点击"保存设置"按钮
   - 确认设置已保存

### 第二步: 组织管理模块状态

1. **当前状态**
   - 组织管理模块已下线
   - 等待新方案重构上线

### 第三步: 管理Agent团队

1. **查看Agent列表**
   - 访问"Agent管理"页面
   - 查看CEO (Alex Chen) 和 CTO (Sarah Kim)

2. **创建新Agent**
   - 点击"创建Agent"
   - 填写基本信息
   - 选择AI模型
   - 设置能力和工具权限

3. **配置Agent属性**
   - 系统提示词
   - 个性特征
   - 在“更换模型”弹窗中可同时切换该Agent绑定的API Key
   - 薪资和职责范围

### 第四步: 计划编排

1. **创建与编排任务**
   - 访问"计划编排"页面
   - 在编排流程中创建任务
   - 填写任务详情并设置协作方式

2. **选择协作模式**
   - 自由讨论模式: 适合头脑风暴
   - 流水线模式: 适合分步骤任务
   - 并行协作模式: 适合独立子任务
   - 分级监督模式: 适合复杂项目

3. **执行任务**
   - 点击"执行"按钮
   - 系统将自动协调Agent协作
   - 实时查看执行进度

### 第五步: 公司治理模块状态

1. **当前状态**
   - 公司治理模块已下线
   - 等待新方案重构上线

### 会议协作模式

1. **进入会议页面**
   - 打开"会议"页面并选择一个会议

2. **切换发言模式**
   - **自由讨论**: 人类发言后，所有在场Agent都会给出回应
   - **有序发言**: Agent发言后需要等待下一次人类发言才会继续响应

3. **暂停与恢复**
   - 会议进行中可点击"暂停会议"
   - 暂停后可点击"恢复会议"继续讨论

4. **实时消息**
   - 会议消息通过 WebSocket 实时推送，不依赖定时轮询

5. **@ 点名发言**
   - 在消息中输入 `@AgentName` 可点名指定 Agent 回复
   - 点名后仅被 @ 的在场 Agent 会发言

### 第六步: 绩效管理

1. **查看团队健康度**
   - 访问"人力资源"页面
   - 查看整体团队表现

2. **评估Agent绩效**
   - 选择Agent查看详细报告
   - 查看KPI指标
   - 获取改进建议

3. **处理低绩效员工**
   - 系统自动识别低绩效Agent
   - 查看风险评估
   - 通过人员管理流程处理

---

## 🎯 典型使用场景

### 场景1: 软件开发项目

**目标**: 开发一个新功能

**步骤**:
1. 在计划编排中创建任务: "实现用户认证系统"
2. 选择协作模式: "分级监督"
   - CTO作为主管制定架构
   - 开发工程师执行具体任务
3. 使用工具:
   - 代码执行工具编写代码
   - 数据分析工具处理日志
4. 讨论协作:
   - 创建讨论收集意见
   - CTO审核代码质量
5. 绩效评估:
   - 评估代码质量
   - 计算任务完成率

### 场景2: 团队扩张

**目标**: 招聘新的开发人员

**步骤**:
1. 查看招聘建议
   - 系统分析工作负荷
   - 推荐招聘数量
2. 在计划编排中创建招聘任务
   - 指定角色: 高级开发工程师
   - 设置薪资范围
3. 雇佣Agent
   - 审批通过后雇佣
   - 分配部门和工具权限

### 场景3: 模型对比实验

**目标**: 对比不同AI模型的表现

**步骤**:
1. 创建多个相同角色的Agent
   - Agent A: 使用 GPT-4 Turbo
   - Agent B: 使用 Claude Opus 4.6
   - Agent C: 使用 GPT-4o
2. 在计划编排中分配相同任务
3. 对比结果:
   - 响应质量
   - 执行时间
   - Token消耗
4. 选择最佳模型

---

## 🔧 高级配置

### 自定义工具

1. **添加自定义工具**
```typescript
// 在 ToolService 中添加
{
  id: 'custom-tool',
  name: 'Custom Tool',
  type: 'custom',
  category: 'Custom',
  requiredPermissions: [{ level: 'advanced' }],
  tokenCost: 50
}
```

2. **实现工具逻辑**
```typescript
private async executeCustomTool(params: any): Promise<any> {
  // 实现工具功能
  return { result: 'success' };
}
```

### 自定义角色

```typescript
// 在 OrganizationService 中添加
{
  id: 'custom-role',
  title: 'Custom Role',
  department: '技术',
  level: 'senior',
  salaryRange: { min: 10000, max: 15000 },
  responsibilities: ['architecture-review', 'tech-planning']
}
```

### 修改投票规则

```typescript
// 组织设置
settings: {
  votingRules: {
    requiredQuorum: 60,      // 修改法定人数
    requiredApproval: 70,    // 修改通过门槛
    votingPeriod: 48         // 修改投票时间(小时)
  }
}
```

---

## 🐛 故障排除

### 问题1: Agent无法连接到AI模型

**症状**: Agent执行任务时返回错误

**解决步骤**:
1. 检查API密钥是否正确配置
   ```bash
   curl http://localhost:3001/api/models/debug/status
   ```
2. 测试模型连接
   ```bash
   curl http://localhost:3001/api/models/gpt-4-turbo/test
   ```
3. 检查Agent使用的模型ID是否正确
4. 若使用 GPT-5 系列模型，确认后端版本已支持 `max_completion_tokens` 参数映射（旧版本会报 `max_tokens` 不支持）

### 问题1.1: 新增模型在重启后消失

**症状**: 在模型管理中添加模型后，服务重启后模型列表丢失

**解决步骤**:
1. 确认服务版本已包含模型注册表持久化（`model_registry` 集合）
2. 检查 MongoDB 连接是否正常，且 agents 服务有写入权限
3. 通过 `GET /api/model-management/available` 验证模型是否已落库

### 问题2: 组织初始化失败

**症状**: 点击"初始化组织"无响应

**解决步骤**:
1. 检查MongoDB是否运行
2. 查看后端日志
3. 确保已选择核心角色模型

### 问题3: 前端无法连接后端

**症状**: 页面显示空白或错误

**解决步骤**:
1. 检查后端是否运行
2. 检查前端代理配置
3. 查看浏览器控制台错误

---

## 💡 最佳实践

### 1. 模型选择建议

**CEO角色**:
- Claude Opus 4.6: 最适合战略决策
- GPT-4 Turbo: 综合能力强
- GPT-4o: 性价比高

**CTO角色**:
- GPT-4 Turbo: 编程能力最强
- Claude Sonnet 4.6: 代码与架构能力优秀
- DeepSeek Coder: 中文编程支持好

### 2. 团队协作优化

- **小规模讨论** (2-3人): 使用自由讨论模式
- **大型项目** (5+人): 使用分级监督模式
- **简单任务**: 使用流水线模式
- **独立任务**: 使用并行协作模式

### 3. 成本控制

- 为不同任务选择合适的模型
- 设置Token消耗上限
- 定期评估工具使用效率
- 及时淘汰低绩效Agent

---

## 📚 相关文档

- [项目概览](../overview/README.md)
- [功能清单](../feature/FUNCTIONS.md)
- [架构设计](../architecture/ARCHITECTURE.md)
- [API文档](../api/API.md)
- [开发日志](../development/CHANGELOG.md)

---

**最后更新**: 2026-02-25
