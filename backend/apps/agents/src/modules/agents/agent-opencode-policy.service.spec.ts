import { AgentOpenCodePolicyService } from './agent-opencode-policy.service';

describe('AgentOpenCodePolicyService', () => {
  const createService = () => new AgentOpenCodePolicyService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  describe('resolveAlertReceiverId', () => {
    it('uses actor employeeId when actor is a human user', () => {
      const service = createService() as any;
      const receiverId = service.resolveAlertReceiverId({
        actor: { employeeId: 'emp-1001' },
        collaborationContext: { initiatorId: 'emp-2002' },
      });

      expect(receiverId).toBe('emp-1001');
    });

    it('falls back to collaborationContext.initiatorId when actor is system user', () => {
      const service = createService() as any;
      const receiverId = service.resolveAlertReceiverId({
        actor: { employeeId: 'legacy-service' },
        collaborationContext: { initiatorId: 'emp-2002' },
      });

      expect(receiverId).toBe('emp-2002');
    });

    it('falls back to collaborationContext.initiator.id when initiatorId is absent', () => {
      const service = createService() as any;
      const receiverId = service.resolveAlertReceiverId({
        actor: { employeeId: 'system' },
        collaborationContext: {
          initiator: {
            id: 'emp-3003',
          },
        },
      });

      expect(receiverId).toBe('emp-3003');
    });
  });
});
