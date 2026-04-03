export interface ChannelTarget {
  configId: string;
  providerType: string;
  targetType: 'group' | 'user';
  providerConfig: Record<string, unknown>;
}
