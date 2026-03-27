import { SceneOptimizationService } from '../../src/modules/orchestration/services/scene-optimization.service';

describe('SceneOptimizationService', () => {
  function createService(planModelOverrides: Record<string, unknown> = {}) {
    const planModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ metadata: {} }),
          }),
        }),
      }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      ...planModelOverrides,
    } as any;

    const service = new SceneOptimizationService(planModel);
    return { service, planModel };
  }

  it('applies requirementId backfill optimization for development plan task', async () => {
    const { service, planModel } = createService();

    const result = await service.applyPostExecuteOptimizations({
      planId: 'plan-1',
      planDomainType: 'development',
      taskId: 'task-1',
      runtimeTaskType: 'development.plan',
      taskStatus: 'completed',
      taskOutput: 'step result\nrequirementId=req-abc_123',
    });

    expect(result.appliedRuleIds).toContain('development-plan-requirement-id-backfill');
    expect(planModel.updateOne).toHaveBeenCalledWith(
      { _id: 'plan-1' },
      { $set: { 'metadata.requirementId': 'req-abc_123' } },
    );
  });

  it('applies requirementId backfill for general-type step1 task in development plan', async () => {
    const { service, planModel } = createService();

    const result = await service.applyPostExecuteOptimizations({
      planId: 'plan-1',
      planDomainType: 'development',
      taskId: 'task-1',
      runtimeTaskType: 'general',
      taskStatus: 'completed',
      taskOutput: 'requirementId: req-1774625464365-82z8ro\n标题原文: 计划详情页-停止执行加图标',
    });

    expect(result.appliedRuleIds).toContain('development-plan-requirement-id-backfill');
    expect(planModel.updateOne).toHaveBeenCalledWith(
      { _id: 'plan-1' },
      { $set: { 'metadata.requirementId': 'req-1774625464365-82z8ro' } },
    );
  });

  it('does not apply optimization when scene does not match', async () => {
    const { service, planModel } = createService();

    const result = await service.applyPostExecuteOptimizations({
      planId: 'plan-1',
      planDomainType: 'general',
      taskId: 'task-1',
      runtimeTaskType: 'general',
      taskStatus: 'completed',
      taskOutput: 'requirementId=req-abc_123',
    });

    expect(result.appliedRuleIds).toEqual([]);
    expect(planModel.updateOne).not.toHaveBeenCalled();
  });

  it('does not overwrite existing requirementId metadata', async () => {
    const { service, planModel } = createService({
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ metadata: { requirementId: 'req-existing' } }),
          }),
        }),
      }),
    });

    const result = await service.applyPostExecuteOptimizations({
      planId: 'plan-1',
      planDomainType: 'development',
      taskId: 'task-1',
      runtimeTaskType: 'development.plan',
      taskStatus: 'completed',
      taskOutput: 'requirementId=req-abc_123',
    });

    expect(result.appliedRuleIds).toEqual([]);
    expect(planModel.updateOne).not.toHaveBeenCalled();
  });
});
