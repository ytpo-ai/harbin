import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FeishuModule } from '../../providers/feishu/feishu.module';
import { ChannelConfigController } from './channel-config.controller';
import { ChannelAggregatorService } from './channel-aggregator.service';
import { ChannelConfigService } from './channel-config.service';
import { ChannelProviderRegistry } from './channel-provider.registry';
import { ChannelDispatcherService } from './channel-dispatcher.service';
import { ChannelConfig, ChannelConfigSchema } from './schemas/channel-config.schema';
import { ChannelDeliveryLog, ChannelDeliveryLogSchema } from './schemas/channel-delivery-log.schema';

@Module({
  imports: [
    FeishuModule,
    MongooseModule.forFeature([
      { name: ChannelConfig.name, schema: ChannelConfigSchema },
      { name: ChannelDeliveryLog.name, schema: ChannelDeliveryLogSchema },
    ]),
  ],
  controllers: [ChannelConfigController],
  providers: [ChannelConfigService, ChannelProviderRegistry, ChannelDispatcherService, ChannelAggregatorService],
  exports: [ChannelConfigService],
})
export class ChannelModule {}
