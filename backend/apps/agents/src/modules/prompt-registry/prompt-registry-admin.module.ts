import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromptRegistryController } from './prompt-registry.controller';
import { PromptRegistryAdminService } from './prompt-registry-admin.service';
import { PromptRegistryModule as PromptRegistryCoreModule } from '../../../../../src/modules/prompt-registry/prompt-registry.module';
import { PromptTemplate, PromptTemplateSchema } from '../../../../../src/shared/schemas/prompt-template.schema';
import {
  PromptTemplateAudit,
  PromptTemplateAuditSchema,
} from '../../../../../src/shared/schemas/prompt-template-audit.schema';

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
})
export class PromptRegistryAdminModule {}
