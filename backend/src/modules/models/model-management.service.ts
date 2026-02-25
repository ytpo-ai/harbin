import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AVAILABLE_MODELS, MODEL_CATEGORIES, getRecommendedModels, getModelsByProvider, getModelById } from '../../config/models';
import { AIModel } from '../../shared/types';

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
    return getModelsByProvider(provider);
  }

  createModel(modelData: Omit<AIModel, 'id'> & { id?: string }): AIModel {
    const { id, ...modelWithoutId } = modelData;
    const modelId = id ?? uuidv4();

    const existingModel = this.models.find(m => m.id === modelId);
    if (existingModel) {
      throw new ConflictException(`Model with ID ${modelId} already exists`);
    }

    const newModel: AIModel = {
      ...modelWithoutId,
      id: modelId,
    };

    this.models.push(newModel);
    this.logger.log(`Created new model: ${newModel.name} (${newModel.id})`);
    
    return newModel;
  }

  updateModel(modelId: string, updates: Partial<AIModel>): AIModel {
    const modelIndex = this.models.findIndex(m => m.id === modelId);
    if (modelIndex === -1) {
      throw new NotFoundException(`Model with ID ${modelId} not found`);
    }

    // 不允许修改ID
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
}