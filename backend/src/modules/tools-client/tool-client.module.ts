import { Module } from '@nestjs/common';
import { ToolClientService } from './tool-client.service';

@Module({
  providers: [ToolClientService],
  exports: [ToolClientService],
})
export class ToolClientModule {}
