import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Load environment variables from a single .env file.
 * Existing process.env values are NOT overwritten.
 */
export function loadEnvFromFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * Bootstrap environment by loading .env files in priority order.
 * The `root` defaults to `backend/` (one level above `scripts/`).
 */
export function bootstrapEnv(root?: string): void {
  const base = root || resolve(__dirname, '../..');
  loadEnvFromFile(resolve(base, '.env'));
  loadEnvFromFile(resolve(base, '.env.development'));
  loadEnvFromFile(resolve(base, '.env.local'));
}

/**
 * Get the MongoDB connection URI from environment variables.
 */
export function getMongoUri(): string {
  return process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agent-team';
}

/**
 * Build a Redis URL from environment variables.
 * Supports `REDIS_URL` direct pass-through or host/port assembly.
 */
export function getRedisUrl(): string {
  const password = process.env.REDIS_PASSWORD || '';
  const db = process.env.REDIS_DB || '0';

  const rawUrl = process.env.REDIS_URL;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!parsed.password && password) {
        parsed.password = password;
      }
      if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = `/${db}`;
      }
      return parsed.toString();
    } catch {
      // fallback to host/port assembly
    }
  }

  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT || '6379';
  const authPart = password ? `:${encodeURIComponent(password)}@` : '';
  return `redis://${authPart}${host}:${port}/${db}`;
}
