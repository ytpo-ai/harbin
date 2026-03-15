import { Injectable } from '@nestjs/common';
import { EngineeringIntelligence } from './ei.service';
import { CreateStatisticsSnapshotDto } from '../dto';

@Injectable()
export class EiStatisticsService {
  constructor(private readonly core: EngineeringIntelligence) {}

  createSnapshot(payload: CreateStatisticsSnapshotDto) {
    return this.core.createStatisticsSnapshot(payload);
  }

  getLatestSnapshot() {
    return this.core.getLatestStatisticsSnapshot();
  }

  getSnapshotById(snapshotId: string) {
    return this.core.getStatisticsSnapshotById(snapshotId);
  }

  listSnapshots(limit?: number) {
    return this.core.listStatisticsSnapshots(limit);
  }
}
