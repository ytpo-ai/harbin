import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import axios from 'axios';
import { GatewayProxyService } from './gateway-proxy.service';

describe('GatewayProxyService', () => {
  const originalDebugTimeout = process.env.GATEWAY_DEBUG_RUN_TIMEOUT_MS;
  const originalDefaultTimeout = process.env.GATEWAY_PROXY_TIMEOUT_MS;
  const originalSseTimeout = process.env.GATEWAY_SSE_PROXY_TIMEOUT_MS;

  afterEach(() => {
    process.env.GATEWAY_DEBUG_RUN_TIMEOUT_MS = originalDebugTimeout;
    process.env.GATEWAY_PROXY_TIMEOUT_MS = originalDefaultTimeout;
    process.env.GATEWAY_SSE_PROXY_TIMEOUT_MS = originalSseTimeout;
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

  it('uses SSE timeout and stream response for task events', async () => {
    process.env.GATEWAY_SSE_PROXY_TIMEOUT_MS = '600000';
    const service = createService();
    const pipe = jest.fn();
    const mockStream = {
      pipe,
      on: jest.fn(),
      destroy: jest.fn(),
    };
    const requestSpy = jest.spyOn(axios, 'request').mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      data: mockStream,
    } as any);

    const req: any = {
      method: 'GET',
      originalUrl: '/api/agents/tasks/task-1/events',
      url: '/api/agents/tasks/task-1/events',
      headers: { accept: 'text/event-stream' },
      query: {},
      body: undefined,
      on: jest.fn(),
    };
    const res = createRes();

    await service.forward(req, res);

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 600000, responseType: 'stream' }),
    );
    expect(pipe).toHaveBeenCalledWith(res);
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
