import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RedisService } from '@libs/infra';
import { UpdateDocsHeatConfigDto } from '../dto/docs-heat.dto';
import { EiAppConfig, EiAppConfigDocument, EiDocsHeatConfig } from '../schemas/ei-app-config.schema';

const EI_APP_CONFIG_CACHE_KEY = 'ei:app-config:v1';

const DEFAULT_DOCS_HEAT_CONFIG: EiDocsHeatConfig = {
  weights: [
    { pattern: 'docs/features/**', weight: 1.5, label: '功能文档' },
    { pattern: 'docs/dailylog/**', weight: 1.2, label: '每日进度' },
    { pattern: 'docs/plan/**', weight: 0.8, label: '计划文档' },
    { pattern: 'docs/issue/**', weight: 1.0, label: '修复记录' },
    { pattern: 'docs/**', weight: 1.0, label: '其他文档' },
  ],
  excludes: [],
  defaultWeight: 1.0,
  topN: 20,
};

@Injectable()
export class EiAppConfigService {
  constructor(
    @InjectModel(EiAppConfig.name)
    private readonly appConfigModel: Model<EiAppConfigDocument>,
    private readonly redisService: RedisService,
  ) {}

  async getConfig(): Promise<{ configId: string; docsHeat: EiDocsHeatConfig; updatedAt?: Date }> {
    const cached = await this.redisService.get(EI_APP_CONFIG_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return {
          configId: 'default',
          docsHeat: this.normalizeDocsHeatConfig(parsed?.docsHeat),
          updatedAt: parsed?.updatedAt ? new Date(parsed.updatedAt) : undefined,
        };
      } catch {
        // ignore broken cache and fallback to mongo
      }
    }

    const record = await this.appConfigModel.findOne({ configId: 'default' }).lean().exec();
    if (record) {
      const normalized = {
        configId: 'default',
        docsHeat: this.normalizeDocsHeatConfig(record.docsHeat),
        updatedAt: record.updatedAt,
      };
      await this.redisService.set(EI_APP_CONFIG_CACHE_KEY, JSON.stringify(normalized));
      return normalized;
    }

    const fallback = {
      configId: 'default',
      docsHeat: this.normalizeDocsHeatConfig(undefined),
      updatedAt: undefined,
    };
    await this.redisService.set(EI_APP_CONFIG_CACHE_KEY, JSON.stringify(fallback));
    return fallback;
  }

  async getDocsHeatConfig(): Promise<EiDocsHeatConfig> {
    const config = await this.getConfig();
    return this.normalizeDocsHeatConfig(config.docsHeat);
  }

  async updateDocsHeatConfig(dto: UpdateDocsHeatConfigDto): Promise<{ configId: string; docsHeat: EiDocsHeatConfig }> {
    const nextDocsHeat = this.normalizeDocsHeatConfig({
      weights: dto.weights,
      excludes: dto.excludes,
      defaultWeight: dto.defaultWeight,
      topN: dto.topN,
      updatedAt: new Date(),
      updatedBy: dto.updatedBy || 'unknown',
    });

    await this.appConfigModel
      .updateOne(
        { configId: 'default' },
        {
          $set: {
            configId: 'default',
            docsHeat: nextDocsHeat,
          },
        },
        { upsert: true },
      )
      .exec();

    const payload = {
      configId: 'default',
      docsHeat: nextDocsHeat,
      updatedAt: new Date(),
    };
    await this.redisService.set(EI_APP_CONFIG_CACHE_KEY, JSON.stringify(payload));

    return {
      configId: 'default',
      docsHeat: nextDocsHeat,
    };
  }

  private normalizeDocsHeatConfig(raw: any): EiDocsHeatConfig {
    const weights = Array.isArray(raw?.weights)
      ? raw.weights
          .map((item: any) => ({
            pattern: String(item?.pattern || '').trim(),
            weight: Number(item?.weight || 0),
            label: item?.label ? String(item.label).trim() : undefined,
          }))
          .filter((item: any) => item.pattern && Number.isFinite(item.weight) && item.weight > 0)
      : DEFAULT_DOCS_HEAT_CONFIG.weights;

    const excludes = Array.isArray(raw?.excludes)
      ? raw.excludes.map((item: any) => String(item || '').trim()).filter(Boolean)
      : [];

    const defaultWeight = Number(raw?.defaultWeight);
    const topN = Number(raw?.topN);

    return {
      weights: weights.length ? weights : DEFAULT_DOCS_HEAT_CONFIG.weights,
      excludes,
      defaultWeight: Number.isFinite(defaultWeight) && defaultWeight > 0 ? defaultWeight : DEFAULT_DOCS_HEAT_CONFIG.defaultWeight,
      topN: Number.isFinite(topN) && topN > 0 ? Math.floor(topN) : DEFAULT_DOCS_HEAT_CONFIG.topN,
      updatedAt: raw?.updatedAt ? new Date(raw.updatedAt) : undefined,
      updatedBy: raw?.updatedBy ? String(raw.updatedBy) : undefined,
    };
  }
}
