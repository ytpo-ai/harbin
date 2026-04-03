import { Module } from '@nestjs/common';
import { FeishuCardBuilder } from './feishu-card-builder';
import { FeishuWebhookProvider } from './feishu-webhook.provider';

@Module({
  providers: [FeishuCardBuilder, FeishuWebhookProvider],
  exports: [FeishuWebhookProvider],
})
export class FeishuModule {}
