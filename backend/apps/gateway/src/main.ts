import { NestFactory } from '@nestjs/core';
import { GatewayAppModule } from './app.module';
import { ResponseInterceptor } from '../../../src/shared/common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(GatewayAppModule);
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  const port = Number(process.env.GATEWAY_PORT || 3100);
  await app.listen(port);
  console.log(`Gateway service running on http://localhost:${port}`);
}

bootstrap();
