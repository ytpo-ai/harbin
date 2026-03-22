import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ModelManagementService, ModelSettings, FounderModelSelection } from './model-management.service';
import { AIModel } from '../../../../../src/shared/types';

type ModelPayload = AIModel & {
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
  };
};

@Controller('model-management')
export class ModelManagementController {
  constructor(private readonly modelManagementService: ModelManagementService) {}

  @Get('available')
  getAvailableModels() {
    return this.modelManagementService.getAvailableModels();
  }

  @Get('categories')
  getModelCategories() {
    return this.modelManagementService.getModelCategories();
  }

  @Get('recommended')
  getRecommendedModels() {
    return this.modelManagementService.getRecommendedModels();
  }

  @Get('by-provider/:provider')
  getModelsByProvider(@Param('provider') provider: string) {
    return this.modelManagementService.getModelsByProvider(provider);
  }

  @Post('models')
  createModel(@Body() modelData: Omit<ModelPayload, 'id'>) {
    return this.modelManagementService.createModel(modelData);
  }

  @Put('models/:id')
  updateModel(@Param('id') id: string, @Body() updates: Partial<ModelPayload>) {
    return this.modelManagementService.updateModel(id, updates);
  }

  @Delete('models/:id')
  deleteModel(@Param('id') id: string) {
    return this.modelManagementService.deleteModel(id);
  }

  @Delete('models/:provider/:model')
  deleteModelByProviderAndModel(@Param('provider') provider: string, @Param('model') model: string) {
    return this.modelManagementService.deleteModelByProviderAndModel(provider, decodeURIComponent(model));
  }

  @Get('settings')
  getModelSettings(): ModelSettings {
    return this.modelManagementService.getModelSettings();
  }

  @Put('settings')
  updateModelSettings(@Body() settings: any): ModelSettings {
    return this.modelManagementService.updateModelSettings(settings);
  }

  @Post('select-for-founder/:founderType')
  selectModelForFounder(
    @Param('founderType') founderType: 'ceo' | 'cto',
    @Body() body: { modelId: string }
  ) {
    return this.modelManagementService.selectModelForFounder(founderType, body.modelId);
  }

  @Get('founder-models')
  getFounderModels(): FounderModelSelection {
    return this.modelManagementService.getFounderModels();
  }
}
