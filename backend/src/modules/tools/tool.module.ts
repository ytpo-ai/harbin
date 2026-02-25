import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tool, ToolSchema } from '../../shared/schemas/tool.schema';
import { ToolExecution, ToolExecutionSchema } from '../../shared/schemas/toolExecution.schema';
import { ToolService } from './tool.service';
import { ToolController } from './tool.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tool.name, schema: ToolSchema },
      { name: ToolExecution.name, schema: ToolExecutionSchema }
    ])
  ],
  controllers: [ToolController],
  providers: [ToolService],
  exports: [ToolService],
})
export class ToolModule {}