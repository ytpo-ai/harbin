import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ModelService } from './modules/models/model.service';
import { OrganizationService } from './modules/organization/organization.service';

async function bootstrap() {
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

  // 获取ModelService并初始化默认模型
  const modelService = app.get(ModelService);
  modelService.initializeDefaultModels();

  // 初始化组织架构
  const organizationService = app.get(OrganizationService);
  await organizationService.createInitialOrganization();

  // API前缀
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 AI Agent Team Platform Server running on http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
  console.log(`🏢 AI Company initialized with founder agents!`);
  console.log(`🤖 Ready to manage your AI startup team!`);
}

bootstrap();