import { AgentTaskWorker } from './agent-task.worker';
import { OpenCodeAdapter } from '../opencode/opencode.adapter';
import { OpenCodeExecutionService } from '../opencode/opencode-execution.service';

/**
 * 超时机制单元测试
 *
 * 覆盖场景：
 * 1. withStepTimeout — promise 超时触发 STEP_TIMEOUT_EXCEEDED
 * 2. withStepTimeout — promise 正常完成不触发超时
 * 3. withActivityAwareTimeout — absolute 超时触发
 * 4. withActivityAwareTimeout — inactivity 超时触发（checkActivity 返回 false）
 * 5. withActivityAwareTimeout — checkActivity 异常不刷新 lastActivityAt（P1-1 修复验证）
 * 6. withAbsoluteDeadline — taskTimeoutMs < stepTimeoutMs 时优先触发 TASK_TIMEOUT_EXCEEDED
 * 7. withAbsoluteDeadline — deadline 已过立即触发
 * 8. isRetryableError — STEP_TIMEOUT_EXCEEDED 不可重试（P1-3 修复验证）
 * 9. isRetryableError — TASK_TIMEOUT_EXCEEDED 不可重试
 * 10. isRetryableError — 普通 timeout/network 错误仍可重试
 * 11. adapter getSessionStatus — 异常返回 active:false（P1-1 修复验证）
 * 12. cancelSession — abort 使用短超时（P1-2 修复验证）
 */

function createWorkerInstance(): AgentTaskWorker {
  // 创建最小 mock 实例，仅用于调用 private 方法
  const worker = Object.create(AgentTaskWorker.prototype) as any;
  worker.logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  worker.opencodeInactivityTimeoutMs = 300000;
  worker.opencodeAbsoluteTimeoutMs = 1800000;
  worker.opencodeActivityPollIntervalMs = 30000;
  worker.sessionInitTimeoutMs = 60000;
  return worker;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// 1. withStepTimeout 测试
// ============================================================
describe('withStepTimeout', () => {
  it('rejects with STEP_TIMEOUT_EXCEEDED when promise exceeds timeout', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const neverResolve = new Promise<string>(() => {});

    await expect(
      worker.withStepTimeout(neverResolve, 50, onTimeout),
    ).rejects.toThrow('STEP_TIMEOUT_EXCEEDED');

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('resolves normally when promise completes before timeout', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const fastPromise = Promise.resolve('done');

    const result = await worker.withStepTimeout(fastPromise, 5000, onTimeout);
    expect(result).toBe('done');
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clears timer on promise rejection', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const failingPromise = Promise.reject(new Error('custom_error'));

    await expect(
      worker.withStepTimeout(failingPromise, 5000, onTimeout),
    ).rejects.toThrow('custom_error');
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

// ============================================================
// 2. withActivityAwareTimeout 测试
// ============================================================
describe('withActivityAwareTimeout', () => {
  it('rejects with STEP_TIMEOUT_EXCEEDED on absolute timeout', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const neverResolve = new Promise<string>(() => {});

    await expect(
      worker.withActivityAwareTimeout(neverResolve, {
        inactivityTimeoutMs: 999999,
        absoluteTimeoutMs: 50,
        pollIntervalMs: 10,
        checkActivity: jest.fn().mockResolvedValue(true),
        onTimeout,
      }),
    ).rejects.toThrow('STEP_TIMEOUT_EXCEEDED');

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('rejects on inactivity timeout when checkActivity returns false', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const neverResolve = new Promise<string>(() => {});

    await expect(
      worker.withActivityAwareTimeout(neverResolve, {
        inactivityTimeoutMs: 30,
        absoluteTimeoutMs: 999999,
        pollIntervalMs: 10,
        checkActivity: jest.fn().mockResolvedValue(false),
        onTimeout,
      }),
    ).rejects.toThrow('STEP_TIMEOUT_EXCEEDED');

    expect(onTimeout).toHaveBeenCalled();
  });

  it('does NOT refresh lastActivityAt when checkActivity throws (P1-1 fix)', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const neverResolve = new Promise<string>(() => {});

    // checkActivity 持续抛异常 → 不应该被当做活跃 → inactivity 计时器推进 → 最终触发超时
    await expect(
      worker.withActivityAwareTimeout(neverResolve, {
        inactivityTimeoutMs: 30,
        absoluteTimeoutMs: 999999,
        pollIntervalMs: 10,
        checkActivity: jest.fn().mockRejectedValue(new Error('network error')),
        onTimeout,
      }),
    ).rejects.toThrow('STEP_TIMEOUT_EXCEEDED');

    expect(onTimeout).toHaveBeenCalled();
  });

  it('resolves normally when promise completes before any timeout', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const fastPromise = sleep(10).then(() => 'ok');

    const result = await worker.withActivityAwareTimeout(fastPromise, {
      inactivityTimeoutMs: 999999,
      absoluteTimeoutMs: 999999,
      pollIntervalMs: 5,
      checkActivity: jest.fn().mockResolvedValue(true),
      onTimeout,
    });

    expect(result).toBe('ok');
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

// ============================================================
// 3. withAbsoluteDeadline 测试（任务级 watchdog）
// ============================================================
describe('withAbsoluteDeadline', () => {
  it('rejects with TASK_TIMEOUT_EXCEEDED when deadline is reached', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const neverResolve = new Promise<string>(() => {});
    const deadlineAt = Date.now() + 50;

    await expect(
      worker.withAbsoluteDeadline(neverResolve, deadlineAt, onTimeout),
    ).rejects.toThrow('TASK_TIMEOUT_EXCEEDED');

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately when deadline has already passed', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const neverResolve = new Promise<string>(() => {});
    const pastDeadline = Date.now() - 1000;

    await expect(
      worker.withAbsoluteDeadline(neverResolve, pastDeadline, onTimeout),
    ).rejects.toThrow('TASK_TIMEOUT_EXCEEDED');

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('resolves normally when promise completes before deadline', async () => {
    const worker = createWorkerInstance() as any;
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const fastPromise = Promise.resolve('result');
    const deadlineAt = Date.now() + 5000;

    const result = await worker.withAbsoluteDeadline(fastPromise, deadlineAt, onTimeout);
    expect(result).toBe('result');
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('TASK_TIMEOUT fires before STEP_TIMEOUT when task deadline is shorter', async () => {
    const worker = createWorkerInstance() as any;
    const stepOnTimeout = jest.fn().mockResolvedValue(undefined);
    const taskOnTimeout = jest.fn().mockResolvedValue(undefined);
    const neverResolve = new Promise<string>(() => {});

    // step timeout = 5 秒，task deadline = 50ms
    const stepPromise = worker.withStepTimeout(neverResolve, 5000, stepOnTimeout);
    const taskDeadlineAt = Date.now() + 50;

    await expect(
      worker.withAbsoluteDeadline(stepPromise, taskDeadlineAt, taskOnTimeout),
    ).rejects.toThrow('TASK_TIMEOUT_EXCEEDED');

    expect(taskOnTimeout).toHaveBeenCalledTimes(1);
    // step timeout 不应被触发（因为 task watchdog 先触发）
    expect(stepOnTimeout).not.toHaveBeenCalled();
  });
});

// ============================================================
// 4. isRetryableError 测试
// ============================================================
describe('isRetryableError', () => {
  const worker = createWorkerInstance() as any;

  it('returns false for STEP_TIMEOUT_EXCEEDED (P1-3 fix)', () => {
    expect(worker.isRetryableError('STEP_TIMEOUT_EXCEEDED')).toBe(false);
  });

  it('returns false for TASK_TIMEOUT_EXCEEDED', () => {
    expect(worker.isRetryableError('TASK_TIMEOUT_EXCEEDED')).toBe(false);
  });

  it('returns false for cancel errors', () => {
    expect(worker.isRetryableError('user_cancel')).toBe(false);
    expect(worker.isRetryableError('cancelled')).toBe(false);
  });

  it('returns false for auth/permission errors', () => {
    expect(worker.isRetryableError('authentication_failed')).toBe(false);
    expect(worker.isRetryableError('permission_denied')).toBe(false);
  });

  it('returns true for generic timeout (e.g., HTTP ETIMEDOUT)', () => {
    expect(worker.isRetryableError('ETIMEDOUT')).toBe(true);
    expect(worker.isRetryableError('connect timeout')).toBe(true);
  });

  it('returns true for network errors', () => {
    expect(worker.isRetryableError('ECONNRESET')).toBe(true);
    expect(worker.isRetryableError('network error')).toBe(true);
  });

  it('returns true for 429 / 5xx', () => {
    expect(worker.isRetryableError('429 Too Many Requests')).toBe(true);
    expect(worker.isRetryableError('5xx server error')).toBe(true);
  });

  it('returns false for empty/unknown', () => {
    expect(worker.isRetryableError('')).toBe(false);
    expect(worker.isRetryableError('some random error')).toBe(false);
  });
});

// ============================================================
// 5. OpenCodeAdapter.getSessionStatus — 异常返回 inactive（P1-1 修复验证）
// ============================================================
describe('OpenCodeAdapter.getSessionStatus error handling', () => {
  it('returns active:false when HTTP request throws', async () => {
    const adapter = Object.create(OpenCodeAdapter.prototype) as any;
    adapter.logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    // mock private request method to throw
    adapter.request = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await adapter.getSessionStatus('session-1');
    expect(result.active).toBe(false);
  });
});

// ============================================================
// 6. cancelSession abort 短超时验证（P1-2 修复验证）
// ============================================================
describe('OpenCodeExecutionService.cancelSession abort timeout', () => {
  it('passes short timeout to abortSession', async () => {
    const abortSession = jest.fn().mockResolvedValue({ response: '', metadata: {} });
    const adapter = {
      abortSession,
    } as any;

    const service = new OpenCodeExecutionService(adapter, {} as any, {} as any);
    await service.cancelSession('session-abc');

    expect(abortSession).toHaveBeenCalledTimes(1);
    // 验证传入了 timeoutMs: 10000
    const [sessionId, runtime, options] = abortSession.mock.calls[0];
    expect(sessionId).toBe('session-abc');
    expect(options).toEqual({ timeoutMs: 10_000 });
  });

  it('retries on failure with max 3 attempts and short timeout', async () => {
    const abortSession = jest.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ response: '', metadata: {} });

    const adapter = { abortSession } as any;
    const service = new OpenCodeExecutionService(adapter, {} as any, {} as any);

    const result = await service.cancelSession('session-retry');
    expect(result).toBe(true);
    expect(abortSession).toHaveBeenCalledTimes(3);

    // 所有调用都应该传入短超时
    for (const call of abortSession.mock.calls) {
      expect(call[2]).toEqual({ timeoutMs: 10_000 });
    }
  });

  it('returns true if AbortController was active even when all retries fail', async () => {
    const abortSession = jest.fn().mockRejectedValue(new Error('timeout'));
    const adapter = { abortSession } as any;
    const service = new OpenCodeExecutionService(adapter, {} as any, {} as any);

    // 预先注册一个 AbortController
    const controller = new AbortController();
    (service as any).activeAbortControllers.set('session-fail', controller);

    const result = await service.cancelSession('session-fail');
    // 尽管 abortSession 全部失败，但因为 HTTP 请求已被 abort，所以返回 true
    expect(result).toBe(true);
    expect(abortSession).toHaveBeenCalledTimes(3);
    expect(controller.signal.aborted).toBe(true);
  });
});
