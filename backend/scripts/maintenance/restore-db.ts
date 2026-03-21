/**
 * restore-db.ts — Restore MongoDB from a backup using mongorestore.
 *
 * Usage:
 *   ts-node scripts/maintenance/restore-db.ts --from=./backups/mydb_20260322_103000 --confirm=RESTORE_DATABASE
 *   ts-node scripts/maintenance/restore-db.ts --from=./backups/mydb_20260322_103000 --drop --confirm=RESTORE_DATABASE
 *   ts-node scripts/maintenance/restore-db.ts --from=./backups/mydb_20260322_103000 --collections=agent_sessions --confirm=RESTORE_DATABASE
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const REQUIRED_CONFIRM = 'RESTORE_DATABASE';

interface RestoreOptions {
  from: string;
  drop: boolean;
  collections: string[];
  confirm?: string;
  gzip: boolean;
}

export function parseArgs(argv: string[]): RestoreOptions {
  const fromArg = argv.find((arg) => arg.startsWith('--from='));
  const drop = argv.includes('--drop');
  const gzip = argv.includes('--gzip');
  const collectionsArg = argv.find((arg) => arg.startsWith('--collections='));
  const confirmArg = argv.find((arg) => arg.startsWith('--confirm='));

  return {
    from: fromArg ? fromArg.replace('--from=', '').trim() : '',
    drop,
    gzip,
    collections: collectionsArg
      ? collectionsArg
          .replace('--collections=', '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    confirm: confirmArg ? confirmArg.replace('--confirm=', '').trim() : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkMongorestore(): void {
  try {
    execSync('mongorestore --version', { stdio: 'pipe' });
  } catch {
    console.error('[restore-db] ERROR: mongorestore is not installed or not in PATH.');
    console.error('[restore-db] Install MongoDB Database Tools:');
    console.error('  macOS:   brew install mongodb-database-tools');
    console.error('  Ubuntu:  sudo apt-get install mongodb-database-tools');
    console.error('  Or see:  https://www.mongodb.com/docs/database-tools/installation/');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run(argv?: string[]): Promise<void> {
  bootstrapEnv();
  const options = parseArgs(argv || process.argv.slice(2));

  if (!options.from) {
    throw new Error('--from=<backup-dir> is required');
  }

  if (!existsSync(options.from)) {
    throw new Error(`Backup directory does not exist: ${options.from}`);
  }

  if (options.confirm !== REQUIRED_CONFIRM) {
    throw new Error(`Missing required confirmation. Use --confirm=${REQUIRED_CONFIRM}`);
  }

  checkMongorestore();

  const mongoUri = getMongoUri();

  console.log(`[restore-db] uri=${mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);
  console.log(`[restore-db] from=${options.from}`);
  console.log(`[restore-db] drop=${options.drop}`);
  console.log(`[restore-db] gzip=${options.gzip}`);
  if (options.collections.length > 0) {
    console.log(`[restore-db] collections=${options.collections.join(',')}`);
  }

  // Build mongorestore command
  const args: string[] = ['mongorestore', `--uri="${mongoUri}"`, `"${options.from}"`];

  if (options.drop) {
    args.push('--drop');
  }

  if (options.gzip) {
    args.push('--gzip');
  }

  for (const col of options.collections) {
    args.push(`--nsInclude="*${col}"`);
  }

  const command = args.join(' ');
  console.log(`[restore-db] running: mongorestore ...`);

  const startTime = Date.now();
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`mongorestore failed: ${message}`);
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`[restore-db] restore completed in ${elapsed}s`);
}

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[restore-db] failed: ${message}`);
    process.exit(1);
  });
}
