import { registerAs } from '@nestjs/config';

const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

export default registerAs('redis', () => {
  const redisUrl = process.env.REDIS_URL || DEFAULT_REDIS_URL;
  const parsed = new URL(redisUrl);

  return {
    url: redisUrl,
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password || undefined,
    db: parsed.pathname ? Number(parsed.pathname.slice(1) || 0) : 0,
    tls: parsed.protocol === 'rediss:',
  };
});
