import { NestFactory } from '@nestjs/core';

type SeedName =
  | 'mcp-profiles'
  | 'model-management-agent'
  | 'builtin-tools'
  | 'default-model-registry'
  | 'meeting-monitor';

const ALL_SEEDS: SeedName[] = [
  'mcp-profiles',
  'model-management-agent',
  'builtin-tools',
  'default-model-registry',
  'meeting-monitor',
];

function parseArgs(args: string[]) {
  const onlyArg = args.find((arg) => arg.startsWith('--only='));
  const only = onlyArg
    ? onlyArg
        .replace('--only=', '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return {
    all: args.includes('--all'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    only,
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
  const { all, dryRun, force, only } = parseArgs(process.argv.slice(2));
  const selectedSeeds = resolveSeeds(only, all);

  if (dryRun) {
    console.log(`[seed] dry-run selected: ${selectedSeeds.join(', ')}`);
    return;
  }

  if (force) {
    console.log('[seed] --force enabled');
  }

  const needsAgentsApp = selectedSeeds.some((seed) =>
    ['mcp-profiles', 'model-management-agent', 'builtin-tools', 'default-model-registry'].includes(seed),
  );
  const needsLegacyApp = selectedSeeds.includes('meeting-monitor');

  const { AgentsAppModule, AgentService, ToolService, ModelManagementService } = needsAgentsApp
    ? {
        AgentsAppModule: require('../apps/agents/src/app.module').AgentsAppModule,
        AgentService: require('../apps/agents/src/modules/agents/agent.service').AgentService,
        ToolService: require('../apps/agents/src/modules/tools/tool.service').ToolService,
        ModelManagementService: require('../apps/agents/src/modules/models/model-management.service').ModelManagementService,
      }
    : { AgentsAppModule: null, AgentService: null, ToolService: null, ModelManagementService: null };

  const { AppModule, SchedulerService } = needsLegacyApp
    ? {
        AppModule: require('../src/app.module').AppModule,
        SchedulerService: require('../src/modules/orchestration/scheduler/scheduler.service').SchedulerService,
      }
    : { AppModule: null, SchedulerService: null };

  const agentsApp = needsAgentsApp ? await NestFactory.createApplicationContext(AgentsAppModule) : null;
  const legacyApp = needsLegacyApp ? await NestFactory.createApplicationContext(AppModule) : null;

  try {
    for (const seed of selectedSeeds) {
      console.log(`[seed] start ${seed}`);

      if (seed === 'mcp-profiles') {
        if (!agentsApp) throw new Error('Agents app context not initialized');
        await agentsApp.get(AgentService).seedMcpProfileSeeds();
      }

      if (seed === 'model-management-agent') {
        if (!agentsApp) throw new Error('Agents app context not initialized');
        await agentsApp.get(AgentService).seedModelManagementAgent();
      }

      if (seed === 'builtin-tools') {
        if (!agentsApp) throw new Error('Agents app context not initialized');
        await agentsApp.get(ToolService).seedBuiltinTools();
      }

      if (seed === 'default-model-registry') {
        if (!agentsApp) throw new Error('Agents app context not initialized');
        await agentsApp.get(ModelManagementService).seedDefaultModels();
      }

      if (seed === 'meeting-monitor') {
        if (!legacyApp) throw new Error('Legacy app context not initialized');
        await legacyApp.get(SchedulerService).seedMeetingMonitorSchedule();
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

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed] failed: ${message}`);
  process.exit(1);
});
