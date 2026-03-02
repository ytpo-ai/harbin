import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AVAILABLE_MODELS, MODEL_CATEGORIES, getRecommendedModels } from '../../../../../src/config/models';
import { AIModel } from '../../../../../src/shared/types';
import { ModelRegistry, ModelRegistryDocument } from '../../schemas/model-registry.schema';

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
export class ModelManagementService implements OnModuleInit {
  private readonly logger = new Logger(ModelManagementService.name);

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

  constructor(
    @InjectModel(ModelRegistry.name)
    private readonly modelRegistryModel: Model<ModelRegistryDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaultModels();
  }

  async getAvailableModels(): Promise<AIModel[]> {
    const docs = await this.modelRegistryModel.find().sort({ provider: 1, model: 1 }).lean().exec();
    return docs.map((item) => this.toAIModel(item));
  }

  getModelCategories(): any {
    return MODEL_CATEGORIES;
  }

  getRecommendedModels(): AIModel[] {
    return getRecommendedModels();
  }

  async getModelsByProvider(provider: string): Promise<AIModel[]> {
    const normalizedProvider = this.normalizeProvider(provider);
    const docs = await this.modelRegistryModel
      .find({ provider: normalizedProvider })
      .sort({ model: 1 })
      .lean()
      .exec();
    return docs.map((item) => this.toAIModel(item));
  }

  async createModel(modelData: Omit<AIModel, 'id'> & { id?: string }): Promise<AIModel> {
    const result = await this.addModelToSystem(modelData);
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

  async addModelToSystem(modelData: Omit<AIModel, 'id'> & { id?: string }): Promise<AddModelResult> {
    const { id, ...modelWithoutId } = modelData;
    const normalizedProvider = this.normalizeProvider(modelWithoutId.provider);
    const normalizedModel = String(modelWithoutId.model || '').trim().toLowerCase();
    const normalizedName = String(modelWithoutId.name || normalizedModel || id || 'Custom Model').trim();

    if (!normalizedProvider || !normalizedModel) {
      throw new BadRequestException('provider and model are required');
    }

    const generatedId = this.buildModelId(normalizedProvider, normalizedModel);
    const modelId = (id || generatedId || uuidv4()).trim();

    const existingModel = await this.modelRegistryModel.findOne({ id: modelId }).lean().exec();
    if (existingModel) {
      return {
        created: false,
        model: this.toAIModel(existingModel),
        message: `Model with ID ${modelId} already exists`,
        duplicateBy: 'id',
      };
    }

    const existingByProviderModel = await this.modelRegistryModel
      .findOne({ provider: normalizedProvider, model: normalizedModel })
      .lean()
      .exec();

    if (existingByProviderModel) {
      return {
        created: false,
        model: this.toAIModel(existingByProviderModel),
        message: `Model ${normalizedProvider}/${normalizedModel} already exists`,
        duplicateBy: 'provider_model',
      };
    }

    const payload: AIModel = {
      name: normalizedName,
      provider: normalizedProvider as AIModel['provider'],
      model: normalizedModel,
      id: modelId,
      maxTokens: modelWithoutId.maxTokens,
      temperature: modelWithoutId.temperature,
      topP: modelWithoutId.topP,
    };

    try {
      const created = await this.modelRegistryModel.create(payload);
      const newModel = this.toAIModel(created.toObject());
      this.logger.log(`Created new model: ${newModel.name} (${newModel.id})`);

      return {
        created: true,
        model: newModel,
        message: `Model ${newModel.name} added successfully`,
      };
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        const byId = await this.modelRegistryModel.findOne({ id: modelId }).lean().exec();
        if (byId) {
          return {
            created: false,
            model: this.toAIModel(byId),
            message: `Model with ID ${modelId} already exists`,
            duplicateBy: 'id',
          };
        }

        const byProviderModel = await this.modelRegistryModel
          .findOne({ provider: normalizedProvider, model: normalizedModel })
          .lean()
          .exec();
        if (byProviderModel) {
          return {
            created: false,
            model: this.toAIModel(byProviderModel),
            message: `Model ${normalizedProvider}/${normalizedModel} already exists`,
            duplicateBy: 'provider_model',
          };
        }
      }

      throw error;
    }
  }

  async updateModel(modelId: string, updates: Partial<AIModel>): Promise<AIModel> {
    const existing = await this.modelRegistryModel.findOne({ id: modelId }).lean().exec();
    if (!existing) {
      throw new NotFoundException(`Model with ID ${modelId} not found`);
    }

    const { id, ...updateData } = updates;

    const normalizedUpdateData: Partial<AIModel> = {
      ...updateData,
      provider: updateData.provider ? (this.normalizeProvider(updateData.provider) as AIModel['provider']) : undefined,
      model: updateData.model ? String(updateData.model).trim().toLowerCase() : undefined,
      name: updateData.name?.trim(),
    };

    if (normalizedUpdateData.provider || normalizedUpdateData.model) {
      const candidateProvider = String(normalizedUpdateData.provider || existing.provider);
      const candidateModel = String(normalizedUpdateData.model || existing.model);
      const conflict = await this.modelRegistryModel
        .findOne({ provider: candidateProvider, model: candidateModel, id: { $ne: modelId } })
        .lean()
        .exec();
      if (conflict) {
        throw new ConflictException(
          `Model ${candidateProvider}/${candidateModel} already exists (id=${String(conflict.id)})`,
        );
      }
    }

    await this.modelRegistryModel.updateOne({ id: modelId }, { $set: normalizedUpdateData }).exec();
    const updated = await this.modelRegistryModel.findOne({ id: modelId }).lean().exec();
    if (!updated) {
      throw new NotFoundException(`Model with ID ${modelId} not found`);
    }

    this.logger.log(`Updated model: ${modelId}`);
    return this.toAIModel(updated);
  }

  async deleteModel(modelId: string): Promise<{ success: boolean; message: string }> {
    const deleted = await this.modelRegistryModel.findOneAndDelete({ id: modelId }).lean().exec();
    if (!deleted) {
      throw new NotFoundException(`Model with ID ${modelId} not found`);
    }

    this.logger.log(`Deleted model: ${modelId}`);

    return {
      success: true,
      message: `Model ${modelId} deleted successfully`,
    };
  }

  async deleteModelByProviderAndModel(
    provider: string,
    model: string,
  ): Promise<{ success: boolean; message: string; id: string }> {
    const normalizedProvider = this.normalizeProvider(provider);
    const normalizedModel = String(model || '').trim().toLowerCase();

    const removed = await this.modelRegistryModel
      .findOneAndDelete({ provider: normalizedProvider, model: normalizedModel })
      .lean()
      .exec();

    if (!removed) {
      throw new NotFoundException(`Model ${normalizedProvider}/${normalizedModel} not found`);
    }

    this.logger.log(`Deleted model by provider/model: ${normalizedProvider}/${normalizedModel} (id=${removed.id})`);

    return {
      success: true,
      message: `Model ${normalizedProvider}/${normalizedModel} deleted successfully`,
      id: removed.id,
    };
  }

  getModelSettings(): ModelSettings {
    return this.settings;
  }

  updateModelSettings(settings: Partial<ModelSettings>): ModelSettings {
    this.settings = { ...this.settings, ...settings };
    return this.settings;
  }

  async selectModelForFounder(
    founderType: 'ceo' | 'cto',
    modelId: string,
  ): Promise<{ success: boolean; message: string; model?: AIModel }> {
    const model = await this.getModelById(modelId);
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

  async getModelById(modelId: string): Promise<AIModel | undefined> {
    const model = await this.modelRegistryModel.findOne({ id: modelId }).lean().exec();
    return model ? this.toAIModel(model) : undefined;
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

  private toAIModel(doc: Partial<ModelRegistry>): AIModel {
    return {
      id: String(doc.id || ''),
      name: String(doc.name || ''),
      provider: this.normalizeProvider(String(doc.provider || 'custom')) as AIModel['provider'],
      model: String(doc.model || ''),
      maxTokens: Number(doc.maxTokens || this.settings.defaultMaxTokens),
      temperature: Number(doc.temperature ?? this.settings.defaultTemperature),
      topP: Number(doc.topP ?? 1),
    };
  }

  private isDuplicateKeyError(error: unknown): boolean {
    const err = error as { code?: number };
    return Number(err?.code) === 11000;
  }

  private async seedDefaultModels(): Promise<void> {
    let insertedCount = 0;
    for (const baseModel of AVAILABLE_MODELS) {
      const normalizedProvider = this.normalizeProvider(baseModel.provider);
      const normalizedModel = String(baseModel.model || '').trim().toLowerCase();
      if (!normalizedProvider || !normalizedModel) {
        continue;
      }

      const modelId = String(baseModel.id || this.buildModelId(normalizedProvider, normalizedModel)).trim();
      const payload: AIModel = {
        id: modelId,
        name: String(baseModel.name || normalizedModel).trim(),
        provider: normalizedProvider as AIModel['provider'],
        model: normalizedModel,
        maxTokens: Number(baseModel.maxTokens || this.settings.defaultMaxTokens),
        temperature: Number(baseModel.temperature ?? this.settings.defaultTemperature),
        topP: Number(baseModel.topP ?? 1),
      };

      try {
        const existing = await this.modelRegistryModel
          .findOne({ provider: payload.provider, model: payload.model })
          .lean()
          .exec();
        if (existing) {
          continue;
        }
        await this.modelRegistryModel.create(payload);
        insertedCount += 1;
      } catch (error) {
        if (!this.isDuplicateKeyError(error)) {
          this.logger.warn(
            `Seed default model failed: ${payload.provider}/${payload.model} (${error instanceof Error ? error.message : 'unknown error'})`,
          );
        }
      }
    }

    if (insertedCount > 0) {
      this.logger.log(`Seeded default models: ${insertedCount}`);
    }
  }
}
