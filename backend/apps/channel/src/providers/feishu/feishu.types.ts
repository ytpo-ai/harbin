export interface FeishuProviderConfig {
  webhookUrl: string;
  webhookSecret?: string;
}

export interface FeishuAppProviderConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  receiveId: string;
  receiveIdType?: 'chat_id' | 'open_id';
}

export interface FeishuWebhookResponse {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
}

export interface FeishuWebhookPayload {
  msg_type: 'text' | 'interactive';
  content?: {
    text: string;
  };
  card?: Record<string, unknown>;
  timestamp?: string;
  sign?: string;
}
