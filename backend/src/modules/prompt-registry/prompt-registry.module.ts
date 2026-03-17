import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromptTemplate, PromptTemplateSchema } from '../../shared/schemas/prompt-template.schema';
import { PromptResolverService } from './prompt-resolver.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: PromptTemplate.name, schema: PromptTemplateSchema }])],
  providers: [PromptResolverService],
  exports: [PromptResolverService],
})
export class PromptRegistryModule {}
