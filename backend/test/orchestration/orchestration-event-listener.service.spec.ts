import { OrchestrationEventListenerService } from '../../src/modules/orchestration/services/orchestration-event-listener.service';

describe('OrchestrationEventListenerService', () => {
  it('forwards advance event to dispatcher', async () => {
    const dispatcher = {
      advanceOnce: jest.fn().mockResolvedValue({ advanced: true }),
    } as any;
    const service = new OrchestrationEventListenerService(dispatcher);

    await service.handleAdvanceRequested({
      planId: 'plan-1',
      source: 'api',
      targetPhase: 'executing',
    });

    expect(dispatcher.advanceOnce).toHaveBeenCalledWith('plan-1', {
      source: 'api',
      targetPhase: 'executing',
    });
  });

  it('ignores empty plan id', async () => {
    const dispatcher = {
      advanceOnce: jest.fn(),
    } as any;
    const service = new OrchestrationEventListenerService(dispatcher);

    await service.handleAdvanceRequested({
      planId: ' ',
      source: 'api',
    } as any);

    expect(dispatcher.advanceOnce).not.toHaveBeenCalled();
  });
});
