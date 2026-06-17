import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { GatewayAppModule } from './app.module';
import { ResponseInterceptor } from '../../../src/shared/common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(GatewayAppModule);
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ limit: '5mb', extended: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());

  const corsOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const port = Number(process.env.GATEWAY_PORT || 3100);
  await app.listen(port);
  console.log(`Gateway service running on http://localhost:${port}`);
}

bootstrap();
