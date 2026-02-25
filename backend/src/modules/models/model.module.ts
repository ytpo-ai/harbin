import { Module } from '@nestjs/common';
import { ModelService } from './model.service';
import { ModelController } from './model.controller';
import { ModelManagementController } from './model-management.controller';
import { ModelManagementService } from './model-management.service';

@Module({
  controllers: [ModelController, ModelManagementController],
  providers: [ModelService, ModelManagementService],
  exports: [ModelService, ModelManagementService],
})
export class ModelModule {}