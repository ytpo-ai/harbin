import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AVAILABLE_MODELS, MODEL_CATEGORIES, getRecommendedModels } from '../../../../../src/config/models';
import { AIModel } from '../../../../../src/shared/types';

export interface ModelSettings {
  defaultTemperature: number;
  defaultMaxTokens: number;
  enableStreaming: boolean;
  autoSelectBestModel: boolean;
}

export interface FounderModelSelection {
  ceo: AIModel | null;
  cto: AIModel | null;
}

export interface AddModelResult {
  created: boolean;
  model: AIModel;
  message: string;
  duplicateBy?: 'id' | 'provider_model';
}

@Injectable()
export class ModelManagementService {
  private readonly logger = new Logger(ModelManagementService.name);
  private models: AIModel[] = [...AVAILABLE_MODELS];

  private settings: ModelSettings = {
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    enableStreaming: true,
    autoSelectBestModel: false,
  };

  private founderModels: FounderModelSelection = {
    ceo: null,
    cto: null,
  };

  getAvailableModels(): AIModel[] {
    return this.models;
  }

  getModelCategories(): any {
    return MODEL_CATEGORIES;
  }

  getRecommendedModels(): AIModel[] {
    return getRecommendedModels();
  }

  getModelsByProvider(provider: string): AIModel[] {
    const normalizedProvider = this.normalizeProvider(provider);
    return this.models.filter((model) => this.normalizeProvider(model.provider) === normalizedProvider);
  }

  createModel(modelData: Omit<AIModel, 'id'> & { id?: string }): AIModel {
    const result = this.addModelToSystem(modelData);
    if (!result.created) {
      if (result.duplicateBy === 'id') {
        throw new ConflictException(`Model with ID ${result.model.id} already exists`);
      }
      throw new ConflictException(
        `Model ${result.model.provider}/${result.model.model} already exists (id=${result.model.id})`,
      );
    }

    return result.model;
  }

  addModelToSystem(modelData: Omit<AIModel, 'id'> & { id?: string }): AddModelResult {
    const { id, ...modelWithoutId } = modelData;
    const normalizedProvider = this.normalizeProvider(modelWithoutId.provider);
    const normalizedModel = String(modelWithoutId.model || '').trim();
    const normalizedName = String(modelWithoutId.name || normalizedModel || id || 'Custom Model').trim();

    if (!normalizedProvider || !normalizedModel) {
      throw new BadRequestException('provider and model are required');
    }

    const generatedId = this.buildModelId(normalizedProvider, normalizedModel);
    const modelId = (id || generatedId || uuidv4()).trim();

    const existingModel = this.models.find(m => m.id === modelId);
    if (existingModel) {
      return {
        created: false,
        model: existingModel,
        message: `Model with ID ${modelId} already exists`,
        duplicateBy: 'id',
      };
    }

    const existingByProviderModel = this.models.find(
      (m) =>
        this.normalizeProvider(m.provider) === normalizedProvider &&
        String(m.model || '').trim().toLowerCase() === normalizedModel.toLowerCase(),
    );

    if (existingByProviderModel) {
      return {
        created: false,
        model: existingByProviderModel,
        message: `Model ${normalizedProvider}/${normalizedModel} already exists`,
        duplicateBy: 'provider_model',
      };
    }

    const newModel: AIModel = {
      ...modelWithoutId,
      name: normalizedName,
      provider: normalizedProvider as AIModel['provider'],
      model: normalizedModel,
      id: modelId,
    };

    this.models.push(newModel);
    this.logger.log(`Created new model: ${newModel.name} (${newModel.id})`);

    return {
      created: true,
      model: newModel,
      message: `Model ${newModel.name} added successfully`,
    };
  }

  updateModel(modelId: string, updates: Partial<AIModel>): AIModel {
    const modelIndex = this.models.findIndex(m => m.id === modelId);
    if (modelIndex === -1) {
      throw new NotFoundException(`Model with ID ${modelId} not found`);
    }

    const { id, ...updateData } = updates;

    this.models[modelIndex] = {
      ...this.models[modelIndex],
      ...updateData,
    };

    this.logger.log(`Updated model: ${modelId}`);
    return this.models[modelIndex];
  }

  deleteModel(modelId: string): { success: boolean; message: string } {
    const modelIndex = this.models.findIndex(m => m.id === modelId);
    if (modelIndex === -1) {
      throw new NotFoundException(`Model with ID ${modelId} not found`);
    }

    this.models.splice(modelIndex, 1);
    this.logger.log(`Deleted model: ${modelId}`);

    return {
      success: true,
      message: `Model ${modelId} deleted successfully`,
    };
  }

  getModelSettings(): ModelSettings {
    return this.settings;
  }

  updateModelSettings(settings: Partial<ModelSettings>): ModelSettings {
    this.settings = { ...this.settings, ...settings };
    return this.settings;
  }

  selectModelForFounder(founderType: 'ceo' | 'cto', modelId: string): { success: boolean; message: string; model?: AIModel } {
    const model = this.models.find(m => m.id === modelId);
    if (!model) {
      return {
        success: false,
        message: `Model with ID ${modelId} not found`,
      };
    }

    this.founderModels[founderType] = model;

    return {
      success: true,
      message: `${founderType.toUpperCase()} model updated successfully`,
      model,
    };
  }

  getFounderModels(): FounderModelSelection {
    return this.founderModels;
  }

  getModelById(modelId: string): AIModel | undefined {
    return this.models.find(m => m.id === modelId);
  }

  private normalizeProvider(provider: string): string {
    const value = String(provider || '').trim().toLowerCase();
    if (value === 'kimi') return 'moonshot';
    if (value === 'claude') return 'anthropic';
    return value;
  }

  private buildModelId(provider: string, model: string): string {
    const normalizedProvider = provider.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const normalizedModel = model.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `${normalizedProvider}-${normalizedModel}`;
  }
}
