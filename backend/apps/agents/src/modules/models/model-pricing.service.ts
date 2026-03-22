import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ModelRegistry, ModelRegistryDocument } from '../../schemas/model-registry.schema';

export interface ModelCost {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  reasoning?: number;
}

export interface NormalizedTokens {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
}

interface PricingRecord {
  provider: string;
  model: string;
  cost: ModelCost;
}

interface PricingCacheFile {
  source: 'models.dev';
  updatedAt: string;
  records: PricingRecord[];
}

@Injectable()
export class ModelPricingService implements OnModuleInit {
  private readonly logger = new Logger(ModelPricingService.name);
  private readonly pricingCache = new Map<string, ModelCost>();
  private readonly overrideCache = new Map<string, { expiresAt: number; cost?: ModelCost }>();
  private readonly cachePath: string;
  private readonly overrideTtlMs: number;
  private refreshTimer?: NodeJS.Timeout;
  private lastRefreshAt?: Date;

  constructor(
    @InjectModel(ModelRegistry.name)
    private readonly modelRegistryModel: Model<ModelRegistryDocument>,
  ) {
    const cwd = process.cwd();
    const configuredPath = String(process.env.MODELS_PRICING_CACHE_PATH || '').trim();
    if (configuredPath) {
      this.cachePath = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(cwd, configuredPath);
    } else {
      this.cachePath = path.basename(cwd) === 'backend'
        ? path.resolve(cwd, '../data/cache/models-pricing.json')
        : path.resolve(cwd, 'data/cache/models-pricing.json');
    }

    const configuredTtl = Number(process.env.MODEL_PRICING_OVERRIDE_TTL_MS || 300_000);
    this.overrideTtlMs = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : 300_000;
  }

  async onModuleInit(): Promise<void> {
    await this.loadFromLocalCache();
    void this.refreshFromRemote();
    this.startPeriodicRefresh();
  }

  async getPricing(provider: string, model: string): Promise<ModelCost | undefined> {
    const normalizedProvider = this.normalizeProvider(provider);
    const normalizedModel = String(model || '').trim().toLowerCase();
    if (!normalizedProvider || !normalizedModel) {
      return undefined;
    }

    const override = await this.getRegistryOverride(normalizedProvider, normalizedModel);
    if (override) {
      return override;
    }

    return this.pricingCache.get(this.getCacheKey(normalizedProvider, normalizedModel));
  }

  calculateCost(pricing: ModelCost, tokens: NormalizedTokens): number {
    const input = Number(tokens.input || 0);
    const output = Number(tokens.output || 0);
    const cacheRead = Number(tokens.cacheRead || 0);
    const cacheWrite = Number(tokens.cacheWrite || 0);
    const reasoning = Number(tokens.reasoning || 0);

    const total =
      (input * pricing.input) / 1_000_000 +
      (output * pricing.output) / 1_000_000 +
      (cacheRead * (pricing.cache_read ?? pricing.input)) / 1_000_000 +
      (cacheWrite * (pricing.cache_write ?? pricing.input)) / 1_000_000 +
      (reasoning * (pricing.reasoning ?? pricing.output)) / 1_000_000;

    return Number.isFinite(total) ? total : 0;
  }

  async getPricingStatus(): Promise<{
    lastRefresh?: string;
    modelCount: number;
    overrideCount: number;
    source: 'models.dev+cache';
  }> {
    const overrideCount = await this.countOverrides();
    return {
      lastRefresh: this.lastRefreshAt?.toISOString(),
      modelCount: this.pricingCache.size,
      overrideCount,
      source: 'models.dev+cache',
    };
  }

  async manualRefresh(): Promise<{ success: boolean; modelCount: number; refreshedAt: string }> {
    const refreshed = await this.refreshFromRemote();
    return {
      success: refreshed,
      modelCount: this.pricingCache.size,
      refreshedAt: new Date().toISOString(),
    };
  }

  private async getRegistryOverride(provider: string, model: string): Promise<ModelCost | undefined> {
    const cacheKey = this.getCacheKey(provider, model);
    const now = Date.now();
    const cached = this.overrideCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.cost;
    }

    const doc = await this.modelRegistryModel
      .findOne({ provider, model })
      .select({ cost: 1 })
      .lean()
      .exec();

    const normalizedCost = this.normalizeCost(doc?.cost);
    this.overrideCache.set(cacheKey, {
      expiresAt: now + this.overrideTtlMs,
      cost: normalizedCost,
    });

    return normalizedCost;
  }

  private async loadFromLocalCache(): Promise<void> {
    try {
      const content = await readFile(this.cachePath, 'utf-8');
      const parsed = JSON.parse(content) as PricingCacheFile;
      const records = Array.isArray(parsed?.records) ? parsed.records : [];
      for (const record of records) {
        const provider = this.normalizeProvider(record.provider);
        const model = String(record.model || '').trim().toLowerCase();
        const cost = this.normalizeCost(record.cost);
        if (!provider || !model || !cost) {
          continue;
        }
        this.pricingCache.set(this.getCacheKey(provider, model), cost);
      }
      if (parsed?.updatedAt) {
        const parsedDate = new Date(parsed.updatedAt);
        if (!Number.isNaN(parsedDate.getTime())) {
          this.lastRefreshAt = parsedDate;
        }
      }
      this.logger.log(`Loaded model pricing cache records=${this.pricingCache.size}`);
    } catch (error) {
      this.logger.log('Model pricing cache file not found, skip preload');
    }
  }

  private async refreshFromRemote(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch('https://models.dev/api.json', {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`models.dev request failed: ${response.status}`);
      }

      const payload = (await response.json()) as Record<string, any>;
      const records = this.flattenPricing(payload);
      if (records.length === 0) {
        throw new Error('models.dev payload has no pricing records');
      }

      this.pricingCache.clear();
      for (const record of records) {
        this.pricingCache.set(this.getCacheKey(record.provider, record.model), record.cost);
      }
      this.lastRefreshAt = new Date();

      await this.persistCache(records);
      this.logger.log(`Refreshed model pricing from models.dev records=${records.length}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Refresh model pricing failed: ${message}`);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private flattenPricing(payload: Record<string, any>): PricingRecord[] {
    const records: PricingRecord[] = [];

    for (const [providerKey, providerValue] of Object.entries(payload || {})) {
      const provider = this.normalizeProvider(String(providerValue?.id || providerKey));
      const models = providerValue?.models && typeof providerValue.models === 'object' ? providerValue.models : {};

      for (const [modelKey, modelValue] of Object.entries(models)) {
        const model = String((modelValue as any)?.id || modelKey || '').trim().toLowerCase();
        const cost = this.normalizeCost((modelValue as any)?.cost);
        if (!provider || !model || !cost) {
          continue;
        }
        records.push({ provider, model, cost });
      }
    }

    return records;
  }

  private async persistCache(records: PricingRecord[]): Promise<void> {
    const cacheDir = path.dirname(this.cachePath);
    await mkdir(cacheDir, { recursive: true });

    const payload: PricingCacheFile = {
      source: 'models.dev',
      updatedAt: new Date().toISOString(),
      records,
    };

    await writeFile(this.cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private startPeriodicRefresh(): void {
    this.refreshTimer = setInterval(() => {
      void this.refreshFromRemote();
    }, 60 * 60 * 1000);
    this.refreshTimer.unref();
  }

  private async countOverrides(): Promise<number> {
    return this.modelRegistryModel.countDocuments({
      $or: [
        { 'cost.input': { $type: 'number' } },
        { 'cost.output': { $type: 'number' } },
        { 'cost.cache_read': { $type: 'number' } },
        { 'cost.cache_write': { $type: 'number' } },
        { 'cost.reasoning': { $type: 'number' } },
      ],
    });
  }

  private getCacheKey(provider: string, model: string): string {
    return `${provider}:${model}`;
  }

  private normalizeProvider(provider: string): string {
    const value = String(provider || '').trim().toLowerCase();
    if (value === 'kimi') return 'moonshot';
    if (value === 'claude') return 'anthropic';
    return value;
  }

  private normalizeCost(raw: any): ModelCost | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    const input = Number(raw.input);
    const output = Number(raw.output);
    if (!Number.isFinite(input) || !Number.isFinite(output)) {
      return undefined;
    }

    const normalized: ModelCost = {
      input,
      output,
    };

    const cacheRead = Number(raw.cache_read);
    const cacheWrite = Number(raw.cache_write);
    const reasoning = Number(raw.reasoning);

    if (Number.isFinite(cacheRead)) normalized.cache_read = cacheRead;
    if (Number.isFinite(cacheWrite)) normalized.cache_write = cacheWrite;
    if (Number.isFinite(reasoning)) normalized.reasoning = reasoning;

    return normalized;
  }
}
