import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { WsMessageService } from './ws-message.service';
import { MessageBusService, MESSAGE_BUS } from './messaging';

@Global()
@Module({
  providers: [
    RedisService,
    WsMessageService,
    MessageBusService,
    {
      provide: MESSAGE_BUS,
      useExisting: MessageBusService,
    },
  ],
  exports: [RedisService, WsMessageService, MessageBusService, MESSAGE_BUS],
})
export class InfraModule {}
