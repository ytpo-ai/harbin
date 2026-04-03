import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { createHmac } from 'crypto';
import { ChannelProvider } from '../../contracts/channel-provider.interface';
import { ChannelTarget } from '../../contracts/channel-target.types';
import { ChannelMessage } from '../../contracts/channel-message.types';
import { DeliveryResult } from '../../contracts/delivery-result.types';
import { FeishuCardBuilder } from './feishu-card-builder';
import { FeishuProviderConfig, FeishuWebhookPayload, FeishuWebhookResponse } from './feishu.types';

@Injectable()
export class FeishuWebhookProvider implements ChannelProvider {
  readonly providerType = 'feishu';

  private readonly logger = new Logger(FeishuWebhookProvider.name);
  private readonly timeoutMs = 5000;
  private readonly retryTimes = 2;

  constructor(private readonly cardBuilder: FeishuCardBuilder) {}

  async send(target: ChannelTarget, message: ChannelMessage): Promise<DeliveryResult> {
    const config = this.resolveConfig(target.providerConfig);
    if (!config) {
      return {
        success: false,
        providerType: this.providerType,
        errorMessage: 'invalid provider config',
        deliveredAt: new Date(),
      };
    }

    const payload = this.buildPayload(message, config.webhookSecret);
    const maxAttempts = this.retryTimes + 1;
    let lastError = 'unknown error';
    let lastStatusCode: number | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await axios.post<FeishuWebhookResponse>(config.webhookUrl, payload, {
          timeout: this.timeoutMs,
          headers: {
            'Content-Type': 'application/json',
          },
        });

        lastStatusCode = response.status;
        const responseData = response.data || {};
        const code = Number(responseData.code || responseData.StatusCode || 0);
        if (code === 0) {
          return {
            success: true,
            providerType: this.providerType,
            statusCode: response.status,
            deliveredAt: new Date(),
          };
        }

        const reason = String(responseData.msg || responseData.StatusMessage || `business_error_${code}`);
        lastError = `business:${reason}`;
        if (!this.shouldRetry(undefined, response.status, reason, attempt, maxAttempts)) {
          break;
        }
      } catch (error) {
        const reason = this.classifyError(error);
        lastError = reason;
        const statusCode = (error as any)?.response?.status;
        if (typeof statusCode === 'number') {
          lastStatusCode = statusCode;
        }
        if (!this.shouldRetry(error, statusCode, reason, attempt, maxAttempts)) {
          break;
        }
      }
    }

    this.logger.warn(
      `Feishu delivery failed: configId=${target.configId} statusCode=${String(lastStatusCode || 'n/a')} reason=${lastError}`,
    );

    return {
      success: false,
      providerType: this.providerType,
      statusCode: lastStatusCode,
      errorMessage: lastError,
      deliveredAt: new Date(),
    };
  }

  async validateConfig(config: Record<string, unknown>): Promise<boolean> {
    const resolved = this.resolveConfig(config);
    if (!resolved?.webhookUrl) {
      return false;
    }

    try {
      const parsed = new URL(resolved.webhookUrl);
      if (parsed.protocol !== 'https:') {
        return false;
      }
      if (parsed.hostname !== 'open.feishu.cn') {
        return false;
      }
      return parsed.pathname.includes('/open-apis/bot/v2/hook/');
    } catch {
      return false;
    }
  }

  private resolveConfig(input: Record<string, unknown>): FeishuProviderConfig | null {
    const webhookUrl = String(input.webhookUrl || '').trim();
    const webhookSecret = String(input.webhookSecret || '').trim() || undefined;
    if (!webhookUrl) {
      return null;
    }
    return {
      webhookUrl,
      webhookSecret,
    };
  }

  private buildPayload(message: ChannelMessage, webhookSecret?: string): FeishuWebhookPayload {
    let payload: FeishuWebhookPayload;

    if (message.contentType === 'card') {
      payload = {
        msg_type: 'interactive',
        card: this.cardBuilder.buildTaskResultCard(message),
      };
    } else {
      payload = {
        msg_type: 'text',
        content: {
          text: `${message.title}\n${message.content}`,
        },
      };
    }

    if (webhookSecret) {
      const timestamp = `${Math.floor(Date.now() / 1000)}`;
      const sign = this.buildSign(timestamp, webhookSecret);
      payload.timestamp = timestamp;
      payload.sign = sign;
    }

    return payload;
  }

  private buildSign(timestamp: string, secret: string): string {
    const stringToSign = `${timestamp}\n${secret}`;
    return createHmac('sha256', stringToSign).digest('base64');
  }

  private classifyError(error: unknown): string {
    const statusCode = (error as any)?.response?.status;
    if (statusCode === 429) {
      return 'rate_limit';
    }
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return `business:http_${statusCode}`;
    }
    if (statusCode && statusCode >= 500) {
      return `network:http_${statusCode}`;
    }

    const code = String((error as any)?.code || '').toUpperCase();
    if (code.includes('ECONN') || code.includes('ETIMEDOUT') || code.includes('ENOTFOUND')) {
      return `network:${code.toLowerCase()}`;
    }

    const message = error instanceof Error ? error.message : String(error || 'unknown_error');
    return `network:${message}`;
  }

  private shouldRetry(
    _error: unknown,
    statusCode: number | undefined,
    reason: string,
    attempt: number,
    maxAttempts: number,
  ): boolean {
    if (attempt >= maxAttempts) {
      return false;
    }

    if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
      return true;
    }

    if (reason.startsWith('network:')) {
      return true;
    }

    return false;
  }
}
