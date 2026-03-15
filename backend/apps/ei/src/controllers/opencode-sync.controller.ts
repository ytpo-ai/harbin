import { Body, Controller, Headers, Post } from '@nestjs/common';
import { EiOpencodeSyncService } from '../services/opencode-sync.service';

@Controller('ei')
export class EiOpencodeSyncController {
  constructor(private readonly opencodeSyncService: EiOpencodeSyncService) {}

  @Post('sync-batches')
  syncBatch(@Body() payload: unknown) {
    return this.opencodeSyncService.syncBatch(payload);
  }

  @Post('ingest/events')
  ingestEvents(
    @Body() payload: unknown,
    @Headers('x-ei-node-signature') signature?: string,
    @Headers('x-ei-node-timestamp') timestamp?: string,
  ) {
    return this.opencodeSyncService.ingestEvents({ payload, signature, timestamp });
  }

  @Post('opencode/runs/sync')
  syncBatchCompat(@Body() payload: unknown) {
    return this.opencodeSyncService.syncBatch(payload);
  }

  @Post('opencode/ingest/events')
  ingestEventsCompat(
    @Body() payload: unknown,
    @Headers('x-ei-node-signature') signature?: string,
    @Headers('x-ei-node-timestamp') timestamp?: string,
  ) {
    return this.opencodeSyncService.ingestEvents({ payload, signature, timestamp });
  }
}
