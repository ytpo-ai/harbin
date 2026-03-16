# AI Agent 开发协议

本文件定义了opencode在协助开发本项目时应遵循的协议和规则。

## Shell 环境初始化协议

在执行任何依赖 Node.js / pnpm 的命令前，必须先初始化 nvm 环境：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

## 功能文档维护规范及协议
具体规范及约束请阅读 `docs/features/RULES.md` 中的说明。

## 日常进度记录规范及协议
具体规范及约束请阅读 `docs/dailylog/RULES.md` 中的说明。

## OpenCode Endpoint 优先级提示

请优先阅读 `docs/TIP.MD`。其中定义了 Agent 任务执行时 OpenCode endpoint 的强制优先级与排障要点。

## 需求处理流程协议

当用户提出具体开发需求时，先梳理功能当前的设计方案，必须先输出执行计划（plan），并等待用户明确同意后才可开始编码。

### 开发前必须阅读功能文档

**规则**：
1. 接到开发需求后，先找到对应的 **2级功能文档**
2. 如果功能文档存在且信息足够，则 **不必扫描代码文件**
3. 如果功能文档信息不足，再补充文档或查看代码

### 标准执行顺序
1. 给出计划（plan）
2. 计划得到同意后，将计划更新到 `docs/plan/` 下的 Markdown 文档
3. 完成 plan 文档更新后，再执行开发
4. 开发完成后，先询问用户是否需要沉淀开发总结文档；用户同意后，按照 功能文档维护规范及协议 中的要求更新文档
5. 最后询问用户是否需要提交代码；如果需要，按照 Git Commit 协议 进行提交

### Plan 输出要求
- [ ] 先理解需求并拆解任务范围
- [ ] 输出 3-7 条可执行步骤（按顺序）
- [ ] 标注关键影响点（如后端/API/前端/数据库/测试/文档）
- [ ] 如有风险或依赖，提前说明

### 编码前确认要求
- [ ] 明确询问用户是否同意当前 plan
- [ ] 仅在用户明确回复同意后，先更新 `docs/plan/` 文档，再开始代码修改
- [ ] 若用户要求调整 plan，先更新 plan 并再次确认

### Plan 文档要求
- [ ] 一个 session 尽量维护一个 plan 文档（避免拆分为多个零散文档）
- [ ] 文档文件名应稳定、可追踪，并在后续开发总结中复用同名文件名

### Daily Log 记录要求
- [ ] `docs/dailylog`下文档不应该被其他功能文档引用（仅供记录当天工作内容和影响范围）

### 例外情况
- 纯咨询类问题（无代码改动）可直接回答，无需 plan 确认
- 用户明确说明“直接改/跳过 plan”时，可直接执行
- 用户明确说明“跳过文档落盘”时，可跳过文档更新

## 代码生成后协议

### 1. 文档更新协议

在生成或修改代码后，必须检查和更新相关文档：

#### 必须执行的操作：
- [ ] 检查 `README.md` 是否需要更新（如添加了新功能、改变了使用方式）
- [ ] 根据功能文档维护规范及协议 docs/features/RULES.md 中的要求，更新相关功能文档
- [ ] 如果创建了新的API端点，更新API文档
- [ ] 如果修改了数据模型，更新数据模型文档
- [ ] 根据日常进度记录规范及协议 docs/dailylog/RULES.md 中的要求，记录当天的工作内容和影响范围
- [ ] 如果添加了环境变量，更新 `.env.example` 和配置文档

#### 文档更新优先级：
1. **高优先级**: API变更、配置变更、部署相关
2. **中优先级**: 功能更新、使用方式变更
3. **低优先级**: 代码重构、内部实现优化（如无外部影响）

### 2. Git Commit 协议

在完成代码修改后，按照以下规则提交：

#### Commit Message 格式：
```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Type 类型：
- `feat`: 新功能
- `fix`: 修复bug
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具/配置

#### Scope 范围：
- `backend`: 后端相关
- `frontend`: 前端相关
- `api`: API接口
- `db`: 数据库
- `auth`: 认证授权
- `config`: 配置

#### 提交前检查清单：
- [ ] 运行测试：`npm test` 或 `pytest`
- [ ] 运行代码检查：`npm run lint` 或 `ruff check .`
- [ ] 确认没有提交敏感信息（API Keys、密码等）
- [ ] 确认 `.env` 文件没有被提交

#### 自动提交流程：
1. 用户要求提交时，先询问：
   - "我将为您提交代码，请确认以下信息："
   - 显示 `git status` 和 `git diff --stat`
   - 询问commit message

2. 根据修改内容自动生成commit message建议

3. 执行提交：
   ```bash
   git add .
   git commit -m "<type>(<scope>): <subject>"
   ```

4. 如果用户要求推送：
   ```bash
   git push
   ```

### 3. 代码质量协议

#### 提交前必须运行：
- [ ] **后端**: `npm run lint` 和 `npm run typecheck`
- [ ] **前端**: `npm run lint` 和 `npm run build`（检查编译错误）
- [ ] **Python**: `ruff check .` 和 `mypy .`

#### 如果发现错误：
1. 先修复错误
2. 再次运行检查
3. 确认通过后再提交

### 4. 安全协议

#### 代码安全检查：
- [ ] 不提交 `.env` 文件或包含密钥的文件
- [ ] API Keys 必须使用环境变量
- [ ] 密码必须加密存储（bcrypt等）
- [ ] 用户输入必须进行验证和清理

#### 敏感信息扫描：
提交前检查是否包含：
- API Keys (sk-*, pk_*, etc.)
- 数据库密码
- JWT secrets
- 私钥文件

## 项目特定协议

### 研发智能边界红线（经验教训）

- 当需求为“研发智能独立”时，默认仅拆分 **backend**（`apps/engineering-intelligence`）。
- **frontend 必须保留在主应用 `frontend/` 内**，通过页面与路由承载研发智能功能。
- 未经用户明确要求，不得新增独立前端工程或将研发智能前端代码迁出主前端。
- 若需要独立部署，仅允许后端服务独立部署，前端继续复用主站。

### Agents 生成规则（organizationId 禁止项）

- `organizationId` 已下线，Agents 相关开发中禁止新增、恢复或透传 `organizationId` 字段。
- 禁止系统生成包含 `organizationId` 的代码片段（含 DTO、Schema、接口返回、日志字段、上下文透传、Prompt 示例）。
- 如发现历史残留 `organizationId`，应优先移除或替换为当前有效上下文字段，不得继续沿用。

### 本项目技术栈
- **后端**: Nest.js + TypeScript + MongoDB
- **前端**: React + TypeScript + Tailwind CSS
- **数据库**: MongoDB (Mongoose)

### 代码风格
- 使用TypeScript严格模式
- 后端使用装饰器模式（Nest.js风格）
- 前端使用函数式组件 + React Hooks
- 命名规范：
  - 组件：PascalCase
  - 函数/变量：camelCase
  - 常量：UPPER_SNAKE_CASE
  - 文件：kebab-case

### 前端设计规范
遇到前端开发任务时，请先阅读 `docs/FRONTEND_GUIDELINE.md` 中的前端设计建议规范。

### 测试要求
- 新功能必须包含测试
- 修改现有功能时更新相关测试
- 保持测试覆盖率不降低

## 执行检查点

在完成每个任务后，opencode应主动检查：

1. **文档是否需要更新？**
   - 查看修改的文件类型
   - 判断是否影响用户使用
   - 更新相关文档

2. **是否需要提交代码？**
   - 询问用户是否提交
   - 显示变更摘要
   - 生成合适的commit message

3. **代码质量是否达标？**
   - 运行lint检查
   - 运行类型检查
   - 运行测试

## 例外情况

以下情况可以不严格遵循上述协议：
- 纯文本编辑（README、文档等）
- 临时性调试代码（应明确标记为WIP）
- 用户明确要求跳过某些检查

## 协议更新

本协议可根据项目需求随时更新。更新时应：
1. 修改此文件
2. 在commit message中注明"更新AGENTS.md协议"
3. 简要说明更新的内容
