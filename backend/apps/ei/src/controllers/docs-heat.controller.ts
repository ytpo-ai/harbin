import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { DocsHeatRankingQueryDto, RefreshDocsHeatDto } from '../dto/docs-heat.dto';
import { DocsHeatService } from '../services/docs-heat.service';

@Controller('ei/docs-heat')
export class DocsHeatController {
  constructor(private readonly docsHeatService: DocsHeatService) {}

  @Post('refresh')
  refresh(@Body() payload: RefreshDocsHeatDto) {
    return this.docsHeatService.refresh(payload || {});
  }

  @Get('ranking')
  getRanking(@Query() query: DocsHeatRankingQueryDto) {
    return this.docsHeatService.getRanking(query || {});
  }

  @Get('latest')
  getLatest() {
    return this.docsHeatService.getLatest();
  }
}
