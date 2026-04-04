import { Module } from '@nestjs/common';
import { FeishuCardBuilder } from './feishu-card-builder';
import { FeishuAppProvider } from './feishu-app.provider';
import { FeishuWebhookProvider } from './feishu-webhook.provider';

@Module({
  providers: [FeishuCardBuilder, FeishuWebhookProvider, FeishuAppProvider],
  exports: [FeishuWebhookProvider, FeishuAppProvider],
})
export class FeishuModule {}
