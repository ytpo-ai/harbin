import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModelService } from './model.service';
import { ModelController } from './model.controller';
import { ModelManagementController } from './model-management.controller';
import { ModelManagementService } from './model-management.service';
import { ModelRegistry, ModelRegistrySchema } from '../../schemas/model-registry.schema';
import { ModelPricingService } from './model-pricing.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ModelRegistry.name, schema: ModelRegistrySchema }]),
  ],
  controllers: [ModelController, ModelManagementController],
  providers: [ModelService, ModelManagementService, ModelPricingService],
  exports: [ModelService, ModelManagementService, ModelPricingService],
})
export class ModelModule {}
