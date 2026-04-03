import { ChannelMessage } from './channel-message.types';
import { ChannelTarget } from './channel-target.types';
import { DeliveryResult } from './delivery-result.types';

export interface ChannelProvider {
  readonly providerType: string;
  send(target: ChannelTarget, message: ChannelMessage): Promise<DeliveryResult>;
  validateConfig(config: Record<string, unknown>): Promise<boolean>;
}
