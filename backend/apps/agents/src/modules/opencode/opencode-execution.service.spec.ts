import { OpenCodeExecutionService } from './opencode-execution.service';

describe('OpenCodeExecutionService', () => {
  it('extracts delta from parts payload', () => {
    const service = new OpenCodeExecutionService({} as any, {} as any);
    const text = service['extractDeltaText']({
      parts: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }],
    });
    expect(text).toBe('hello world');
  });

  it('extracts delta from info.content payload', () => {
    const service = new OpenCodeExecutionService({} as any, {} as any);
    const text = service['extractDeltaText']({
      info: { content: 'from info content' },
    });
    expect(text).toBe('from info content');
  });

  it('reconstructs response from events when prompt response empty', async () => {
    const adapter = {
      createSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
      promptSession: jest.fn().mockResolvedValue({ response: '', metadata: {} }),
      subscribeEvents: jest.fn().mockImplementation(async function* () {
        yield {
          type: 'step.progress',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          payload: { delta: 'hello ' },
          raw: {},
        };
        yield {
          type: 'step.progress',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          payload: { parts: [{ type: 'text', text: 'world' }] },
          raw: {},
        };
      }),
    } as any;

    const runtimeOrchestrator = {
      recordLlmDelta: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new OpenCodeExecutionService(adapter, runtimeOrchestrator);
    const result = await service.executeWithRuntimeBridge({
      runtimeContext: {
        runId: 'run-1',
        userMessageId: 'msg-1',
        traceId: 'trace-1',
        sessionId: 'runtime-session-1',
      } as any,
      agentId: 'agent-1',
      taskId: 'task-1',
      taskPrompt: 'test',
      title: 't',
      sessionConfig: {},
      model: {
        providerID: 'openai',
        modelID: 'gpt-4o-mini',
      },
      runtime: undefined,
    });

    expect(result.response).toBe('hello world');
    expect(runtimeOrchestrator.recordLlmDelta).toHaveBeenCalled();
  });
});
