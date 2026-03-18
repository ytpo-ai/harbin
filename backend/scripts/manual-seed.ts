import { NestFactory } from '@nestjs/core';
import { createRequire } from 'module';

type SeedName =
  | 'mcp-profiles'
  | 'model-management-agent'
  | 'builtin-tools'
  | 'default-model-registry'
  | 'system-schedules'
  | 'meeting-monitor'
  | 'agent-roles';

type SeedMode = 'sync' | 'append';

const ALL_SEEDS: SeedName[] = [
  'mcp-profiles',
  'model-management-agent',
  'builtin-tools',
  'default-model-registry',
  'system-schedules',
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
  const needsLegacyApp = selectedSeeds.some((seed) => ['meeting-monitor', 'system-schedules', 'agent-roles'].includes(seed));

  const { AgentsAppModule, AgentService, ToolService, ModelManagementService } = needsAgentsApp
    ? loadAgentsSeedDependencies()
    : { AgentsAppModule: null, AgentService: null, ToolService: null, ModelManagementService: null };

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
        await agentsApp.get(AgentService).seedModelManagementAgent();
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
        await seedSystemSchedules(legacyApp, { only: ['meeting-monitor'] });
      }

      if (seed === 'system-schedules') {
        if (!legacyApp) throw new Error('Legacy app context not initialized');
        await seedSystemSchedules(legacyApp);
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
  return {
    AgentsAppModule,
    AgentService,
    ToolService,
    ModelManagementService,
  };
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
