import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ChannelAuthBridgeService } from './channel-auth-bridge.service';

export interface ChannelApiRequest {
  method: 'get' | 'post' | 'patch' | 'delete';
  url: string;
  data?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
}

@Injectable()
export class ChannelApiClientService {
  private readonly gatewayBaseUrl = process.env.GATEWAY_SERVICE_URL || 'http://127.0.0.1:3100';
  private readonly executeTimeoutMs = Math.max(5000, Number(process.env.CHANNEL_AGENT_EXECUTE_TIMEOUT_MS || 120000));
  private readonly httpClient: AxiosInstance;

  constructor(private readonly authBridgeService: ChannelAuthBridgeService) {
    this.httpClient = axios.create({
      baseURL: this.gatewayBaseUrl,
      timeout: this.executeTimeoutMs,
      validateStatus: () => true,
    });
  }

  async callApiAsUser(employeeId: string, request: ChannelApiRequest): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
    const headers = await this.authBridgeService.buildSignedHeaders(employeeId, {
      'content-type': 'application/json',
    });

    const response = await this.httpClient.request({
      method: request.method,
      url: request.url,
      data: request.data,
      params: request.params,
      headers,
    });

    if (response.status >= 400) {
      throw new Error(`api_request_failed:${response.status}`);
    }

    const payload = response.data;
    if (payload && typeof payload === 'object' && 'data' in payload) {
      const data = (payload as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
      }
      if (data && typeof data === 'object') {
        return data as Record<string, unknown>;
      }
    }
    if (Array.isArray(payload)) {
      return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
    }
    if (payload && typeof payload === 'object') {
      return payload as Record<string, unknown>;
    }

    return {};
  }
}
