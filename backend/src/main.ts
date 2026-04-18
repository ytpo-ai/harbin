import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { initializeNetworkProxy } from '@libs/infra';
import { ResponseInterceptor } from './shared/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './shared/common/filters/http-exception.filter';

async function bootstrap() {
  await initializeNetworkProxy();

  const app = await NestFactory.create(AppModule);

  // 启用CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // 全局验证管道
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // API前缀
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 AI Agent Team Platform Server running on http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
  console.log(`🤖 Ready to manage your AI startup team!`);
}

bootstrap();
