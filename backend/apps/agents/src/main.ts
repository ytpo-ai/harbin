import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AgentsAppModule } from './app.module';
import { initializeNetworkProxy } from '@libs/infra';
import { ModelService } from './modules/models/model.service';

async function bootstrap() {
  await initializeNetworkProxy();

  const app = await NestFactory.create(AgentsAppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix('api');

  const modelService = app.get(ModelService);
  modelService.initializeDefaultModels();

  const port = Number(process.env.AGENTS_PORT || 3002);
  await app.listen(port);
  console.log(`Agents service running on http://localhost:${port}`);
}

bootstrap();
