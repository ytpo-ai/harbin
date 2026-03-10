# Tool Prompt 注入改造开发总结

## 背景

原有“工具使用策略提示”主要在 `agent.service.ts` 里按工具权限/角色条件硬编码追加，扩展与维护成本较高，且不利于通过工具配置统一治理。

## 本次实现

1. **Tool 模型新增 `prompt` 字段**
   - 文件：`backend/src/shared/schemas/tool.schema.ts`
   - 同步共享类型：`backend/src/shared/types.ts`、`frontend/src/types/index.ts`
   - 结果：工具可携带可配置的 system prompt 文本。

2. **内置工具种子支持 prompt 持久化**
   - 文件：`backend/apps/agents/src/modules/tools/tool.service.ts`
   - 在关键工具（agents list / model list / repo read / docs read / updates read / memo search / memo append）的内置定义中加入 `prompt`。
   - 初始化/更新内置工具时会同步写入 `prompt` 字段。

3. **Agent 运行时改为按工具 prompt 自动注入**
   - 文件：`backend/apps/agents/src/modules/agents/agent.service.ts`
   - 新增 `buildToolPromptMessages(...)`：
     - 从 `assignedTools` 提取非空 prompt
     - 按 toolId 稳定排序
     - 去重后追加为 system 消息
   - 移除原先针对 docs/updates/repo/memo/agents/model 的硬编码注入分支。

4. **新增数据库回填脚本**
   - 文件：`backend/scripts/backfill-tool-prompts.ts`
   - package script：`npm run migrate:tool-prompts`
   - 支持参数：
     - `--dry-run`：仅预览
     - `--overwrite`：覆盖已有 prompt
     - `--only=<toolId1,toolId2>`：仅处理指定工具

5. **测试补充**
   - 文件：`backend/apps/agents/src/modules/agents/agent.service.spec.ts`
   - 覆盖点：
     - 仅收集非空 prompt，并按 toolId 排序
     - 相同消息去重

## 使用方式

1. 先回填历史数据（推荐先 dry-run）：

```bash
npm run migrate:tool-prompts -- --dry-run
npm run migrate:tool-prompts
```

2. 后续新增工具时，直接在工具记录写入 `prompt`，Agent 拥有该工具即可自动注入。

## 影响与收益

- 策略下沉到工具配置，减少角色维度硬编码。
- 提示词治理可通过工具数据库与工具管理流程统一维护。
- 能力扩展时仅需配置工具 `prompt`，无需反复修改 Agent 核心执行链路。
