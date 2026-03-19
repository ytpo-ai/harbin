import { AgentService } from './agent.service';

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
