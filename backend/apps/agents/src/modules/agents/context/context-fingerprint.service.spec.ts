import { ContextFingerprintService } from './context-fingerprint.service';

describe('ContextFingerprintService', () => {
  it('uses sessionContext.sessionId for scope when collaborationContext has no sessionId', () => {
    const service = new ContextFingerprintService({} as any);
    const scope = service.resolveSystemContextScope(
      { id: 'agent-1' },
      { id: 'task-1', title: 't', type: 'planning' },
      {
        collaborationContext: { planId: 'plan-1' },
        sessionContext: { sessionId: 'session-123' },
      },
    );

    expect(scope).toBe('session:session-123:agent:agent-1');
  });
});
