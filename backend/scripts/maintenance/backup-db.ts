/**
 * backup-db.ts — Backup MongoDB using mongodump.
 *
 * Usage:
 *   ts-node scripts/maintenance/backup-db.ts
 *   ts-node scripts/maintenance/backup-db.ts --gzip
 *   ts-node scripts/maintenance/backup-db.ts --output=./my-backups --collections=agent_sessions,agent_messages
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface BackupOptions {
  output?: string;
  gzip: boolean;
  collections: string[];
}

export function parseArgs(argv: string[]): BackupOptions {
  const outputArg = argv.find((arg) => arg.startsWith('--output='));
  const gzip = argv.includes('--gzip');
  const collectionsArg = argv.find((arg) => arg.startsWith('--collections='));

  return {
    output: outputArg ? outputArg.replace('--output=', '').trim() : undefined,
    gzip,
    collections: collectionsArg
      ? collectionsArg
          .replace('--collections=', '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkMongodump(): void {
  try {
    execSync('mongodump --version', { stdio: 'pipe' });
  } catch {
    console.error('[backup-db] ERROR: mongodump is not installed or not in PATH.');
    console.error('[backup-db] Install MongoDB Database Tools:');
    console.error('  macOS:   brew install mongodb-database-tools');
    console.error('  Ubuntu:  sudo apt-get install mongodb-database-tools');
    console.error('  Or see:  https://www.mongodb.com/docs/database-tools/installation/');
    process.exit(1);
  }
}

function extractDbName(uri: string): string {
  try {
    const url = new URL(uri);
    const pathname = url.pathname || '/';
    const dbName = pathname.replace(/^\//, '').split('?')[0];
    return dbName || 'backup';
  } catch {
    return 'backup';
  }
}

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function getDirSize(dirPath: string): number {
  let totalSize = 0;
  if (!existsSync(dirPath)) return 0;
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      totalSize += getDirSize(fullPath);
    } else {
      totalSize += statSync(fullPath).size;
    }
  }
  return totalSize;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run(argv?: string[]): Promise<void> {
  bootstrapEnv();
  const options = parseArgs(argv || process.argv.slice(2));

  checkMongodump();

  const mongoUri = getMongoUri();
  const dbName = extractDbName(mongoUri);
  const timestamp = formatTimestamp();
  const outputDir = options.output || resolve(__dirname, '../../backups', `${dbName}_${timestamp}`);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log(`[backup-db] uri=${mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);
  console.log(`[backup-db] output=${outputDir}`);
  console.log(`[backup-db] gzip=${options.gzip}`);

  // Build mongodump command
  const args: string[] = ['mongodump', `--uri="${mongoUri}"`, `--out="${outputDir}"`];

  if (options.gzip) {
    args.push('--gzip');
  }

  for (const col of options.collections) {
    args.push(`--collection="${col}"`);
  }

  const command = args.join(' ');
  console.log(`[backup-db] running: mongodump ...`);

  const startTime = Date.now();
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`mongodump failed: ${message}`);
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  const totalSize = getDirSize(outputDir);
  console.log(`[backup-db] backup completed`);
  console.log(`[backup-db] database: ${dbName}`);
  console.log(`[backup-db] size: ${formatBytes(totalSize)}`);
  console.log(`[backup-db] elapsed: ${elapsed}s`);
  console.log(`[backup-db] path: ${outputDir}`);
}

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[backup-db] failed: ${message}`);
    process.exit(1);
  });
}
