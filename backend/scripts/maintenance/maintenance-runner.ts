/**
 * maintenance-runner.ts — Unified entry point for maintenance tasks.
 *
 * Usage:
 *   ts-node scripts/maintenance/maintenance-runner.ts --task=cleanup-runtime --dry-run
 *   ts-node scripts/maintenance/maintenance-runner.ts --task=cleanup-redis --keep=skill,inner
 *   ts-node scripts/maintenance/maintenance-runner.ts --task=backup --gzip
 *   ts-node scripts/maintenance/maintenance-runner.ts --task=restore --from=./backups/mydb_20260322 --drop --confirm=RESTORE_DATABASE
 */

type TaskName = 'cleanup-runtime' | 'cleanup-redis' | 'backup' | 'restore';

const VALID_TASKS: TaskName[] = ['cleanup-runtime', 'cleanup-redis', 'backup', 'restore'];

function extractTask(argv: string[]): { task: TaskName; passthrough: string[] } {
  const taskArg = argv.find((arg) => arg.startsWith('--task='));
  if (!taskArg) {
    console.error('[maintenance] ERROR: --task=<name> is required');
    console.error(`[maintenance] available tasks: ${VALID_TASKS.join(', ')}`);
    process.exit(1);
  }

  const taskName = taskArg.replace('--task=', '').trim() as TaskName;
  if (!VALID_TASKS.includes(taskName)) {
    console.error(`[maintenance] ERROR: unknown task "${taskName}"`);
    console.error(`[maintenance] available tasks: ${VALID_TASKS.join(', ')}`);
    process.exit(1);
  }

  // Pass through all args except --task=
  const passthrough = argv.filter((arg) => !arg.startsWith('--task='));

  return { task: taskName, passthrough };
}

async function main(): Promise<void> {
  const { task, passthrough } = extractTask(process.argv.slice(2));

  console.log(`[maintenance] task=${task}`);

  switch (task) {
    case 'cleanup-runtime': {
      const { run } = require('./cleanup-runtime') as { run: (argv?: string[]) => Promise<void> };
      await run(passthrough);
      break;
    }
    case 'cleanup-redis': {
      const { run } = require('./cleanup-redis') as { run: (argv?: string[]) => Promise<void> };
      await run(passthrough);
      break;
    }
    case 'backup': {
      const { run } = require('./backup-db') as { run: (argv?: string[]) => Promise<void> };
      await run(passthrough);
      break;
    }
    case 'restore': {
      const { run } = require('./restore-db') as { run: (argv?: string[]) => Promise<void> };
      await run(passthrough);
      break;
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[maintenance] failed: ${message}`);
  process.exit(1);
});
