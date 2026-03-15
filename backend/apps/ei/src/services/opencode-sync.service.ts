import { Injectable } from '@nestjs/common';
import { EngineeringIntelligence } from './ei.service';

@Injectable()
export class EiOpencodeSyncService {
  constructor(private readonly core: EngineeringIntelligence) {}

  syncBatch(payload: unknown) {
    return this.core.syncOpenCodeRun(payload);
  }

  ingestEvents(input: { payload: unknown; signature?: string; timestamp?: string }) {
    return this.core.ingestOpenCodeEvents(input);
  }
}
