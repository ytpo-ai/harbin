import { Injectable, NotFoundException } from '@nestjs/common';
import { ChannelProvider } from '../../contracts/channel-provider.interface';
import { FeishuAppProvider } from '../../providers/feishu/feishu-app.provider';
import { FeishuWebhookProvider } from '../../providers/feishu/feishu-webhook.provider';

@Injectable()
export class ChannelProviderRegistry {
  private readonly providerMap: Map<string, ChannelProvider>;

  constructor(
    feishuWebhookProvider: FeishuWebhookProvider,
    feishuAppProvider: FeishuAppProvider,
  ) {
    this.providerMap = new Map<string, ChannelProvider>([
      [feishuWebhookProvider.providerType, feishuWebhookProvider],
      [feishuAppProvider.providerType, feishuAppProvider],
    ]);
  }

  getProvider(providerType: string): ChannelProvider {
    const normalizedProviderType = String(providerType || '').trim();
    const provider = this.providerMap.get(normalizedProviderType);
    if (!provider) {
      throw new NotFoundException(`channel provider not found: ${normalizedProviderType}`);
    }
    return provider;
  }
}
