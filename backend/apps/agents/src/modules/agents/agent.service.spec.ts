import { AgentService } from './agent.service';
import { BadRequestException, Logger } from '@nestjs/common';

describe('AgentService agent lookup query', () => {
  it('uses id lookup for non-ObjectId identifiers', () => {
    const service = Object.create(AgentService.prototype);
    const query = service['buildAgentLookupQuery']('executive-lead');

    expect(query).toEqual({ id: 'executive-lead' });
  });

  it('supports both _id and id for ObjectId-like identifiers', () => {
    const service = Object.create(AgentService.prototype);
    const query = service['buildAgentLookupQuery']('507f1f77bcf86cd799439011');

    expect(query).toEqual({
      $or: [
        { _id: '507f1f77bcf86cd799439011' },
        { id: '507f1f77bcf86cd799439011' },
      ],
    });
  });
});

describe('AgentService tier resolution', () => {
  it('throws for mismatched tier by default', () => {
    const service = Object.create(AgentService.prototype) as AgentService;

    expect(() =>
      service['resolveAgentTierOrThrow']('operations', 'executive-lead', 'leadership'),
    ).toThrow(BadRequestException);
  });

  it('coerces mismatched tier when coercion is enabled', () => {
    const service = Object.create(AgentService.prototype) as AgentService;
    (service as any).logger = new Logger('AgentServiceTest');
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    const tier = service['resolveAgentTierOrThrow']('operations', 'executive-lead', 'leadership', true);

    expect(tier).toBe('leadership');
    expect((service as any).logger.warn).toHaveBeenCalled();
  });
});
