import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { WsMessageService } from './ws-message.service';

@Global()
@Module({
  providers: [RedisService, WsMessageService],
  exports: [RedisService, WsMessageService],
})
export class InfraModule {}
