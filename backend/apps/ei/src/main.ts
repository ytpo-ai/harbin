import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EngineeringIntelligenceAppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(EngineeringIntelligenceAppModule);
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
