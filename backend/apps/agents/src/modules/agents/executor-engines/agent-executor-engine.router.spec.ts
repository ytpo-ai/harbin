import { AgentExecutorEngineRouter } from './agent-executor-engine.router';

describe('AgentExecutorEngineRouter', () => {
  const nativeDetailed = {
    mode: 'detailed',
    channel: 'native',
    execute: jest.fn(),
  } as any;
  const nativeStreaming = {
    mode: 'streaming',
    channel: 'native',
    execute: jest.fn(),
  } as any;
  const opencodeDetailed = {
    mode: 'detailed',
    channel: 'opencode',
    execute: jest.fn(),
  } as any;
  const opencodeStreaming = {
    mode: 'streaming',
    channel: 'opencode',
    execute: jest.fn(),
  } as any;

  it('resolves engine by mode and channel', () => {
    const router = new AgentExecutorEngineRouter(
      nativeDetailed,
      nativeStreaming,
      opencodeDetailed,
      opencodeStreaming,
    );

    expect(router.resolve('detailed', 'native')).toBe(nativeDetailed);
    expect(router.resolve('streaming', 'native')).toBe(nativeStreaming);
    expect(router.resolve('detailed', 'opencode')).toBe(opencodeDetailed);
    expect(router.resolve('streaming', 'opencode')).toBe(opencodeStreaming);
  });

  it('throws when route does not exist', () => {
    const router = new AgentExecutorEngineRouter(
      nativeDetailed,
      nativeStreaming,
      nativeDetailed,
      nativeStreaming,
    );

    expect(() => router.resolve('streaming', 'opencode')).toThrow(
      'Agent executor engine not found for mode=streaming channel=opencode',
    );
  });
});
