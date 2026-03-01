import { Module } from '@nestjs/common';
import { ModelClientService } from './model-client.service';

@Module({
  providers: [ModelClientService],
  exports: [ModelClientService],
})
export class ModelClientModule {}
