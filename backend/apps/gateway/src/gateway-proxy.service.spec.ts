import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import axios from 'axios';
import { GatewayProxyService } from './gateway-proxy.service';

describe('GatewayProxyService', () => {
  const originalDebugTimeout = process.env.GATEWAY_DEBUG_RUN_TIMEOUT_MS;
  const originalDefaultTimeout = process.env.GATEWAY_PROXY_TIMEOUT_MS;

  afterEach(() => {
    process.env.GATEWAY_DEBUG_RUN_TIMEOUT_MS = originalDebugTimeout;
    process.env.GATEWAY_PROXY_TIMEOUT_MS = originalDefaultTimeout;
    jest.restoreAllMocks();
  });

  const createService = () => {
    return new GatewayProxyService({ create: jest.fn() } as any, { findOne: jest.fn() } as any);
  };

  const createRes = () => {
    const res: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    return res;
  };

  it('uses extended timeout for orchestration debug-run', async () => {
    process.env.GATEWAY_DEBUG_RUN_TIMEOUT_MS = '90000';
    process.env.GATEWAY_PROXY_TIMEOUT_MS = '30000';
    const service = createService();
    const requestSpy = jest.spyOn(axios, 'request').mockResolvedValue({
      status: 200,
      headers: {},
      data: { ok: true },
    } as any);

    const req: any = {
      method: 'POST',
      originalUrl: '/api/orchestration/tasks/task-1/debug-run',
      url: '/api/orchestration/tasks/task-1/debug-run',
      headers: {},
      query: {},
      body: {},
    };
    const res = createRes();

    await service.forward(req, res);

    expect(requestSpy).toHaveBeenCalledWith(expect.objectContaining({ timeout: 90000 }));
  });

  it('throws gateway timeout for axios timeout errors', async () => {
    const service = createService();
    jest
      .spyOn(axios, 'request')
      .mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED', isAxiosError: true }));

    const req: any = {
      method: 'POST',
      originalUrl: '/api/orchestration/tasks/task-1/debug-run',
      url: '/api/orchestration/tasks/task-1/debug-run',
      headers: {},
      query: {},
      body: {},
    };
    const res = createRes();

    await expect(service.forward(req, res)).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('throws bad gateway for non-timeout upstream failures', async () => {
    const service = createService();
    jest.spyOn(axios, 'request').mockRejectedValue(Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }));

    const req: any = {
      method: 'POST',
      originalUrl: '/api/orchestration/tasks/task-1/debug-run',
      url: '/api/orchestration/tasks/task-1/debug-run',
      headers: {},
      query: {},
      body: {},
    };
    const res = createRes();

    await expect(service.forward(req, res)).rejects.toBeInstanceOf(BadGatewayException);
  });
});
