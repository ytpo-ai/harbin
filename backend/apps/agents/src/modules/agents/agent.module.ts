import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agent, AgentSchema } from '@agent/schemas/agent.schema';
import { AgentRun, AgentRunSchema } from '../../schemas/agent-run.schema';
import { Skill, SkillSchema } from '../../schemas/agent-skill.schema';
import { AgentRole, AgentRoleSchema } from '../../schemas/agent-role.schema';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { ModelModule } from '../models/model.module';
import { ApiKeysModule } from '../../../../../src/modules/api-keys/api-keys.module';
import { ToolModule } from '../tools/tool.module';
import { MemoModule } from '../memos/memo.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { OpenCodeModule } from '../opencode/opencode.module';
import { AgentExecutorRuntimeService } from './agent-executor-runtime.service';
import { AgentAfterStepEvaluationHook } from './hooks/agent-after-step-evaluation.hook';
import { AgentBeforeStepOptimizationHook } from './hooks/agent-before-step-optimization.hook';
import { AgentOpenCodePolicyService } from './agent-opencode-policy.service';
import { AgentRoleService } from './agent-role.service';
import { AgentExecutorService } from './agent-executor.service';
import { PromptRegistryModule as PromptRegistryCoreModule } from '../prompt-registry/prompt-registry.module';
import { AgentExecutorEngineRouter } from './executor-engines/agent-executor-engine.router';
import { NativeAgentExecutorEngine } from './executor-engines/native-agent-executor.engine';
import { NativeStreamingAgentExecutorEngine } from './executor-engines/native-streaming-agent-executor.engine';
import { OpencodeAgentExecutorEngine } from './executor-engines/opencode-agent-executor.engine';
import { OpencodeStreamingAgentExecutorEngine } from './executor-engines/opencode-streaming-agent-executor.engine';
import { HookRegistryService } from '../runtime/hooks/hook-registry.service';
import { AgentActionLogModule } from '../action-logs/agent-action-log.module';
import { ContextModule } from './context/context.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: AgentRun.name, schema: AgentRunSchema },
      { name: Skill.name, schema: SkillSchema },
      { name: AgentRole.name, schema: AgentRoleSchema },
    ]),
    ModelModule,
    ApiKeysModule,
    ToolModule,
    MemoModule,
    AgentActionLogModule,
    RuntimeModule,
    OpenCodeModule,
    PromptRegistryCoreModule,
    ContextModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentExecutorRuntimeService,
    AgentBeforeStepOptimizationHook,
    AgentAfterStepEvaluationHook,
    AgentOpenCodePolicyService,
    AgentRoleService,
    AgentExecutorEngineRouter,
    NativeAgentExecutorEngine,
    NativeStreamingAgentExecutorEngine,
    OpencodeAgentExecutorEngine,
    OpencodeStreamingAgentExecutorEngine,
    AgentExecutorService,
  ],
  exports: [AgentService],
})
export class AgentModule implements OnModuleInit {
  constructor(
    private readonly hookRegistry: HookRegistryService,
    private readonly beforeStepHook: AgentBeforeStepOptimizationHook,
    private readonly afterStepHook: AgentAfterStepEvaluationHook,
  ) {}

  onModuleInit(): void {
    this.hookRegistry.register(this.beforeStepHook);
    this.hookRegistry.register(this.afterStepHook);
  }
}
