import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { EngineeringIntelligenceAppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(EngineeringIntelligenceAppModule);
  const bodyLimit = String(process.env.ENGINEERING_INTELLIGENCE_BODY_LIMIT || '2mb').trim() || '2mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.ENGINEERING_INTELLIGENCE_FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  const port = Number(process.env.ENGINEERING_INTELLIGENCE_PORT || 3004);
  await app.listen(port);
  console.log(`Engineering Intelligence service running on http://localhost:${port}`);
}

bootstrap();
