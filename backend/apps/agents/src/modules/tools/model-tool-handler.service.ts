import { Injectable } from '@nestjs/common';
import { ModelManagementService } from '../models/model-management.service';

@Injectable()
export class ModelToolHandler {
  constructor(private readonly modelManagementService: ModelManagementService) {}

  private normalizeProvider(provider?: string): string {
    const value = String(provider || '').trim().toLowerCase();
    if (value === 'kimi') return 'moonshot';
    if (value === 'claude') return 'anthropic';
    return value;
  }

  private toModelDisplayName(model: string): string {
    return model
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  async addModelToSystem(params: {
    provider: string;
    model: string;
    name?: string;
    id?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  }): Promise<any> {
    if (!params?.provider || !params?.model) {
      throw new Error('model_mcp_add_model requires parameters: provider, model');
    }

    const normalizedProvider = this.normalizeProvider(params.provider);
    const normalizedModel = String(params.model).trim().toLowerCase();
    const maxTokens = Number.isFinite(Number(params.maxTokens)) ? Number(params.maxTokens) : 8192;
    const temperature = Number.isFinite(Number(params.temperature)) ? Number(params.temperature) : 0.7;
    const topP = Number.isFinite(Number(params.topP)) ? Number(params.topP) : 1;

    const result = await this.modelManagementService.addModelToSystem({
      id: params.id,
      name: params.name?.trim() || this.toModelDisplayName(normalizedModel),
      provider: normalizedProvider as any,
      model: normalizedModel,
      maxTokens,
      temperature,
      topP,
    });

    return {
      created: result.created,
      duplicateBy: result.duplicateBy || null,
      message: result.message,
      model: result.model,
      timestamp: new Date().toISOString(),
    };
  }

  async listSystemModels(params: { provider?: string; limit?: number }): Promise<any> {
    const provider = this.normalizeProvider(params?.provider);
    const limit = Math.max(1, Math.min(Number(params?.limit || 200), 500));

    const sourceModels = provider
      ? await this.modelManagementService.getModelsByProvider(provider)
      : await this.modelManagementService.getAvailableModels();

    const models = sourceModels.slice(0, limit).map((model) => ({
      id: model.id,
      name: model.name,
      provider: this.normalizeProvider(model.provider),
      model: model.model,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      topP: model.topP,
    }));

    return {
      total: sourceModels.length,
      returned: models.length,
      provider: provider || 'all',
      models,
      timestamp: new Date().toISOString(),
    };
  }
}
