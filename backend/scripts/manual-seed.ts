import { NestFactory } from '@nestjs/core';
import { createRequire } from 'module';

type SeedName =
  | 'mcp-profiles'
  | 'model-management-agent'
  | 'builtin-tools'
  | 'default-model-registry'
  | 'system-schedules'
  | 'docs-heat'
  | 'meeting-monitor'
  | 'agent-roles';

type SeedMode = 'sync' | 'append';

const ALL_SEEDS: SeedName[] = [
  'mcp-profiles',
  'model-management-agent',
  'builtin-tools',
  'default-model-registry',
  'system-schedules',
  'docs-heat',
  'meeting-monitor',
  'agent-roles',
];

const localRequire = createRequire(__filename);

function parseArgs(args: string[]) {
  const onlyArg = args.find((arg) => arg.startsWith('--only='));
  const only = onlyArg
    ? onlyArg
        .replace('--only=', '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  const modeArg = args.find((arg) => arg.startsWith('--mode='));
  const modeRaw = modeArg ? modeArg.replace('--mode=', '').trim().toLowerCase() : 'sync';
  if (modeRaw && !['sync', 'append'].includes(modeRaw)) {
    throw new Error(`Unsupported seed mode: ${modeRaw}`);
  }
  const mode: SeedMode = modeRaw === 'append' ? 'append' : 'sync';

  return {
    all: args.includes('--all'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    only,
    mode,
  };
}

function resolveSeeds(only: string[], useAll: boolean): SeedName[] {
  if (only.length > 0) {
    const invalid = only.filter((name) => !ALL_SEEDS.includes(name as SeedName));
    if (invalid.length) {
      throw new Error(`Unsupported seed names: ${invalid.join(', ')}`);
    }
    return Array.from(new Set(only)) as SeedName[];
  }

  if (useAll) {
    return [...ALL_SEEDS];
  }

  throw new Error('No seeds selected. Use --all or --only=<seed1,seed2>.');
}

async function run(): Promise<void> {
  const { all, dryRun, force, only, mode } = parseArgs(process.argv.slice(2));
  const selectedSeeds = resolveSeeds(only, all);

  if (dryRun) {
    console.log(`[seed] dry-run selected: ${selectedSeeds.join(', ')}, mode=${mode}`);
    return;
  }

  if (force) {
    console.log('[seed] --force enabled');
  }

  const needsAgentsApp = selectedSeeds.some((seed) =>
    ['mcp-profiles', 'model-management-agent', 'builtin-tools', 'default-model-registry'].includes(seed),
  );
  const needsLegacyApp = selectedSeeds.some((seed) => ['meeting-monitor', 'system-schedules', 'docs-heat', 'agent-roles'].includes(seed));

  const {
    AgentsAppModule,
    AgentService,
    ToolService,
    ModelManagementService,
    getModelToken,
    Agent,
    AVAILABLE_MODELS,
    MODEL_MANAGEMENT_AGENT_NAME,
    MODEL_MANAGEMENT_ROLE_ID,
    MODEL_MANAGEMENT_AGENT_TOOLS,
    MODEL_MANAGEMENT_AGENT_DESCRIPTION,
    MODEL_MANAGEMENT_AGENT_SYSTEM_PROMPT,
  } = needsAgentsApp
    ? loadAgentsSeedDependencies()
    : {
        AgentsAppModule: null,
        AgentService: null,
        ToolService: null,
        ModelManagementService: null,
        getModelToken: null,
        Agent: null,
        AVAILABLE_MODELS: null,
        MODEL_MANAGEMENT_AGENT_NAME: null,
        MODEL_MANAGEMENT_ROLE_ID: null,
        MODEL_MANAGEMENT_AGENT_TOOLS: null,
        MODEL_MANAGEMENT_AGENT_DESCRIPTION: null,
        MODEL_MANAGEMENT_AGENT_SYSTEM_PROMPT: null,
      };

  if (needsAgentsApp) {
    process.env.AGENT_TASK_SSE_ENABLED = 'false';
  }

  const { AppModule, seedSystemSchedules, seedAgentRoles } = needsLegacyApp
    ? loadLegacySeedDependencies()
    : { AppModule: null, seedSystemSchedules: null, seedAgentRoles: null };

  const agentsApp = needsAgentsApp ? await NestFactory.createApplicationContext(AgentsAppModule) : null;
  const legacyApp = needsLegacyApp ? await NestFactory.createApplicationContext(AppModule) : null;

  try {
    for (const seed of selectedSeeds) {
      console.log(`[seed] start ${seed}`);

      if (seed === 'mcp-profiles') {
        if (!agentsApp) throw new Error('Agents app context not initialized');
        await agentsApp.get(AgentService).seedMcpProfileSeeds(mode);
      }

      if (seed === 'model-management-agent') {
        if (!agentsApp) throw new Error('Agents app context not initialized');
        await seedModelManagementAgentRecord(agentsApp, {
          getModelToken,
          Agent,
          AVAILABLE_MODELS,
          MODEL_MANAGEMENT_AGENT_NAME,
          MODEL_MANAGEMENT_ROLE_ID,
          MODEL_MANAGEMENT_AGENT_TOOLS,
          MODEL_MANAGEMENT_AGENT_DESCRIPTION,
          MODEL_MANAGEMENT_AGENT_SYSTEM_PROMPT,
        });
      }

      if (seed === 'builtin-tools') {
        if (!agentsApp) throw new Error('Agents app context not initialized');
        await agentsApp.get(ToolService).seedBuiltinTools(mode);
      }

      if (seed === 'default-model-registry') {
        if (!agentsApp) throw new Error('Agents app context not initialized');
        await agentsApp.get(ModelManagementService).seedDefaultModels();
      }

      if (seed === 'meeting-monitor') {
        if (!legacyApp) throw new Error('Legacy app context not initialized');
        const result = await seedSystemSchedules(legacyApp, { only: ['meeting-monitor'] });
        console.log(`[seed] meeting-monitor: total=${result.total}, enabled=${result.enabled}, seeded=${result.seeded.join(',')}`);
      }

      if (seed === 'system-schedules') {
        if (!legacyApp) throw new Error('Legacy app context not initialized');
        const result = await seedSystemSchedules(legacyApp);
        console.log(`[seed] system-schedules: total=${result.total}, enabled=${result.enabled}, seeded=${result.seeded.join(',')}`);
      }

      if (seed === 'docs-heat') {
        if (!legacyApp) throw new Error('Legacy app context not initialized');
        const result = await seedSystemSchedules(legacyApp, { only: ['docs-heat'] });
        console.log(`[seed] docs-heat: total=${result.total}, enabled=${result.enabled}, seeded=${result.seeded.join(',')}`);
      }

      if (seed === 'agent-roles') {
        if (!legacyApp) throw new Error('Legacy app context not initialized');
        const result = await seedAgentRoles(legacyApp);
        console.log(`[seed] agent-roles: created=${result.created}, updated=${result.updated}, total=${result.seedCount}`);
      }

      console.log(`[seed] done ${seed}`);
    }
  } finally {
    if (agentsApp) {
      await agentsApp.close();
    }
    if (legacyApp) {
      await legacyApp.close();
    }
  }
}

function loadAgentsSeedDependencies() {
  const { AgentsAppModule } = localRequire('../apps/agents/src/app.module');
  const { AgentService } = localRequire('../apps/agents/src/modules/agents/agent.service');
  const { ToolService } = localRequire('../apps/agents/src/modules/tools/tool.service');
  const { ModelManagementService } = localRequire('../apps/agents/src/modules/models/model-management.service');
  const { getModelToken } = localRequire('@nestjs/mongoose');
  const { Agent } = localRequire('../apps/agents/src/schemas/agent.schema');
  const { AVAILABLE_MODELS } = localRequire('../src/config/models');
  const {
    MODEL_MANAGEMENT_AGENT_NAME,
    MODEL_MANAGEMENT_ROLE_ID,
    MODEL_MANAGEMENT_AGENT_TOOLS,
    MODEL_MANAGEMENT_AGENT_DESCRIPTION,
    MODEL_MANAGEMENT_AGENT_SYSTEM_PROMPT,
  } = localRequire('../apps/agents/src/modules/agents/model-management-agent.constants');
  return {
    AgentsAppModule,
    AgentService,
    ToolService,
    ModelManagementService,
    getModelToken,
    Agent,
    AVAILABLE_MODELS,
    MODEL_MANAGEMENT_AGENT_NAME,
    MODEL_MANAGEMENT_ROLE_ID,
    MODEL_MANAGEMENT_AGENT_TOOLS,
    MODEL_MANAGEMENT_AGENT_DESCRIPTION,
    MODEL_MANAGEMENT_AGENT_SYSTEM_PROMPT,
  };
}

async function seedModelManagementAgentRecord(
  app: any,
  deps: {
    getModelToken: (name: string) => string;
    Agent: { name: string };
    AVAILABLE_MODELS: Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      maxTokens?: number;
      temperature?: number;
      topP?: number;
      reasoning?: unknown;
    }>;
    MODEL_MANAGEMENT_AGENT_NAME: string;
    MODEL_MANAGEMENT_ROLE_ID: string;
    MODEL_MANAGEMENT_AGENT_TOOLS: readonly string[];
    MODEL_MANAGEMENT_AGENT_DESCRIPTION: string;
    MODEL_MANAGEMENT_AGENT_SYSTEM_PROMPT: string;
  },
): Promise<void> {
  const agentModel = app.get(deps.getModelToken(deps.Agent.name));

  const pickDefaultModel = () => {
    const preferredIds = ['gpt-4o-mini', 'gpt-4o', 'claude-sonnet-4-6', 'gemini-1.5-flash'];
    for (const modelId of preferredIds) {
      const found = deps.AVAILABLE_MODELS.find((item) => item.id === modelId);
      if (found) return found;
    }
    return deps.AVAILABLE_MODELS[0];
  };

  const existing = await agentModel.findOne({ name: deps.MODEL_MANAGEMENT_AGENT_NAME }).exec();
  if (existing) {
    await agentModel
      .updateOne(
        { _id: existing._id },
        {
          $addToSet: {
            tools: { $each: [...deps.MODEL_MANAGEMENT_AGENT_TOOLS] },
            capabilities: {
              $each: ['model_discovery', 'model_registry_management', 'internet_research'],
            },
          },
          $set: {
            isActive: true,
            roleId: deps.MODEL_MANAGEMENT_ROLE_ID,
            description: deps.MODEL_MANAGEMENT_AGENT_DESCRIPTION,
            systemPrompt: deps.MODEL_MANAGEMENT_AGENT_SYSTEM_PROMPT,
          },
        },
      )
      .exec();
    return;
  }

  const model = pickDefaultModel();
  await agentModel
    .create({
      name: deps.MODEL_MANAGEMENT_AGENT_NAME,
      roleId: deps.MODEL_MANAGEMENT_ROLE_ID,
      description: deps.MODEL_MANAGEMENT_AGENT_DESCRIPTION,
      model: {
        id: model.id,
        name: model.name,
        provider: model.provider,
        model: model.model,
        maxTokens: model.maxTokens || 8192,
        temperature: model.temperature ?? 0.2,
        topP: model.topP,
        reasoning: model.reasoning,
      },
      capabilities: ['model_discovery', 'model_registry_management', 'internet_research'],
      systemPrompt: deps.MODEL_MANAGEMENT_AGENT_SYSTEM_PROMPT,
      isActive: true,
      tools: ['builtin.web-retrieval.internal.web-search.exa', ...deps.MODEL_MANAGEMENT_AGENT_TOOLS],
      permissions: ['model_registry_read', 'model_registry_write'],
      personality: {
        workEthic: 90,
        creativity: 70,
        leadership: 60,
        teamwork: 85,
      },
      learningAbility: 88,
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Model management agent seed failed: ${message}`);
    });
}

function loadLegacySeedDependencies() {
  const { AppModule } = localRequire('../src/app.module');
  const { seedSystemSchedules } = localRequire('./system-schedule-seed');
  const { seedAgentRoles } = localRequire('./role-seed');
  return {
    AppModule,
    seedSystemSchedules,
    seedAgentRoles,
  };
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed] failed: ${message}`);
  process.exit(1);
});
