import { Controller, Get, Post, Query } from '@nestjs/common';
import { UsageAggregationService } from './usage-aggregation.service';
import { ModelPricingService } from '../models/model-pricing.service';

@Controller('usage')
export class UsageController {
  constructor(
    private readonly usageAggregationService: UsageAggregationService,
    private readonly modelPricingService: ModelPricingService,
  ) {}

  @Get('overview')
  async getOverview(@Query('period') period?: 'week' | 'month') {
    return this.usageAggregationService.getOverview(period === 'week' ? 'week' : 'month');
  }

  @Get('daily-trend')
  async getDailyTrend(@Query('from') from?: string, @Query('to') to?: string) {
    return this.usageAggregationService.getDailyTrend(from, to);
  }

  @Get('by-agent')
  async getByAgent(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usageAggregationService.getByAgent(from, to, Number(limit || 10));
  }

  @Get('by-model')
  async getByModel(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usageAggregationService.getByModel(from, to, Number(limit || 10));
  }

  @Get('pricing/status')
  async getPricingStatus() {
    return this.modelPricingService.getPricingStatus();
  }

  @Post('pricing/refresh')
  async refreshPricing() {
    return this.modelPricingService.manualRefresh();
  }
}
