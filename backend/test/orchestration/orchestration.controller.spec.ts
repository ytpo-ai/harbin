import { OrchestrationController } from '../../src/modules/orchestration/orchestration.controller';

describe('OrchestrationController', () => {
  const orchestrationService = {
    cancelRun: jest.fn(),
    publishPlan: jest.fn(),
    unlockPlan: jest.fn(),
  } as any;
  const sessionManagerService = {} as any;
  const authService = {
    getEmployeeFromToken: jest.fn(),
  } as any;

  const controller = new OrchestrationController(orchestrationService, sessionManagerService, authService);

  beforeEach(() => {
    jest.clearAllMocks();
    authService.getEmployeeFromToken.mockResolvedValue({ id: 'employee-1' });
  });

  it('delegates cancelRun after auth check', async () => {
    orchestrationService.cancelRun.mockResolvedValue({ success: true });

    await controller.cancelRun('run-1', { reason: 'manual stop' } as any, 'Bearer token');

    expect(authService.getEmployeeFromToken).toHaveBeenCalledWith('token');
    expect(orchestrationService.cancelRun).toHaveBeenCalledWith('run-1', 'manual stop');
  });

  it('delegates publishPlan after auth check', async () => {
    orchestrationService.publishPlan.mockResolvedValue({ _id: 'plan-1', status: 'production' });

    await controller.publishPlan('plan-1', 'Bearer token');

    expect(authService.getEmployeeFromToken).toHaveBeenCalledWith('token');
    expect(orchestrationService.publishPlan).toHaveBeenCalledWith('plan-1');
  });

  it('delegates unlockPlan after auth check', async () => {
    orchestrationService.unlockPlan.mockResolvedValue({ _id: 'plan-1', status: 'planned' });

    await controller.unlockPlan('plan-1', 'Bearer token');

    expect(authService.getEmployeeFromToken).toHaveBeenCalledWith('token');
    expect(orchestrationService.unlockPlan).toHaveBeenCalledWith('plan-1');
  });
});
