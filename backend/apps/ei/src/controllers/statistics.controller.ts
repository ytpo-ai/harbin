import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateStatisticsSnapshotDto } from '../dto';
import { EiStatisticsService } from '../services/statistics.service';

@Controller('ei/statistics')
export class EiStatisticsController {
  constructor(private readonly statisticsService: EiStatisticsService) {}

  @Post('snapshots')
  createSnapshot(@Body() payload: CreateStatisticsSnapshotDto) {
    return this.statisticsService.createSnapshot(payload || {});
  }

  @Get('snapshots/latest')
  getLatestSnapshot() {
    return this.statisticsService.getLatestSnapshot();
  }

  @Get('snapshots/:snapshotId')
  getSnapshotById(@Param('snapshotId') snapshotId: string) {
    return this.statisticsService.getSnapshotById(snapshotId);
  }

  @Get('snapshots')
  listSnapshots(@Query('limit') limit?: string) {
    return this.statisticsService.listSnapshots(limit ? Number(limit) : 20);
  }
}
