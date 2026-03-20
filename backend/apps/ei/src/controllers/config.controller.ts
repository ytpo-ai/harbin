import { Body, Controller, Get, Headers, Put, Query } from '@nestjs/common';
import { UpdateDocsHeatConfigDto } from '../dto/docs-heat.dto';
import { EiAppConfigService } from '../services/ei-app-config.service';

@Controller('ei/config')
export class EiConfigController {
  constructor(private readonly appConfigService: EiAppConfigService) {}

  @Get()
  async getConfig(@Query('section') section?: string) {
    if (section === 'docsHeat') {
      const docsHeat = await this.appConfigService.getDocsHeatConfig();
      return { section: 'docsHeat', docsHeat };
    }
    return this.appConfigService.getConfig();
  }

  @Put('docs-heat')
  async updateDocsHeatConfig(
    @Body() payload: UpdateDocsHeatConfigDto,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.appConfigService.updateDocsHeatConfig({
      ...payload,
      updatedBy: payload?.updatedBy || actorId || 'unknown',
    });
  }
}
