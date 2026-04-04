export interface FeishuInboundMessage {
  providerType: 'feishu-app';
  externalUserId: string;
  externalChatId: string;
  chatType: 'p2p' | 'group';
  messageId: string;
  messageText: string;
  displayName?: string;
  mentions?: string[];
  rawEvent?: Record<string, unknown>;
  receivedAt: string;
}

export interface FeishuCardActionEnvelope {
  providerType: 'feishu-app';
  operatorOpenId: string;
  chatId?: string;
  messageId?: string;
  actionValue: Record<string, unknown>;
  rawEvent?: Record<string, unknown>;
}
