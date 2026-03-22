import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromptRegistryController } from './prompt-registry.controller';
import { PromptRegistryAdminService } from './prompt-registry-admin.service';
import { PromptRegistryModule as PromptRegistryCoreModule } from './prompt-registry.module';
import { PromptTemplate, PromptTemplateSchema } from '../../schemas/prompt-template.schema';
import {
  PromptTemplateAudit,
  PromptTemplateAuditSchema,
} from '../../schemas/prompt-template-audit.schema';

@Module({
  imports: [
    PromptRegistryCoreModule,
    MongooseModule.forFeature([
      { name: PromptTemplate.name, schema: PromptTemplateSchema },
      { name: PromptTemplateAudit.name, schema: PromptTemplateAuditSchema },
    ]),
  ],
  controllers: [PromptRegistryController],
  providers: [PromptRegistryAdminService],
  exports: [PromptRegistryAdminService],
})
export class PromptRegistryAdminModule {}
