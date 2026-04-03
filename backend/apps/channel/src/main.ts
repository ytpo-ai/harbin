import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ChannelAppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(ChannelAppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix('api');

  const port = Number(process.env.CHANNEL_PORT || 3006);
  await app.listen(port);
  console.log(`Channel service running on http://localhost:${port}`);
}

bootstrap();
