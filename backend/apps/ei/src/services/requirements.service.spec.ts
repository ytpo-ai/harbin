import { BadRequestException } from '@nestjs/common';
import { EiRequirementsService } from './requirements.service';

describe('EiRequirementsService sequential requirement order', () => {
  function createRequirementModelMock(options: {
    currentRequirement: any;
    scopedRequirements: Array<{ requirementId: string; status: string }>;
  }) {
    return {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(options.currentRequirement),
      }),
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(options.scopedRequirements),
          }),
        }),
      }),
      countDocuments: jest.fn(),
      create: jest.fn(),
      deleteOne: jest.fn(),
    };
  }

  function createPlanModelMock() {
    return {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              strategy: { mode: 'sequential' },
              metadata: {
                taskContext: {
                  requirements: [
                    { requirementId: 'req-1' },
                    { requirementId: 'req-2' },
                  ],
                },
              },
            }),
          }),
        }),
      }),
    };
  }

  function buildService(requirementStatusForReq1: 'assigned' | 'done') {
    const currentRequirement = {
      requirementId: 'req-2',
      title: 'SHARED_REQ-002: 共享服务层',
      labels: ['req:SHARED_REQ-002'],
      projectId: 'gift-designer',
      status: 'assigned',
      linkedPlanIds: [],
      comments: [],
      assignments: [],
      statusHistory: [],
      save: jest.fn().mockResolvedValue(undefined),
      toObject: jest.fn().mockImplementation(function toObject() {
        return this;
      }),
    };

    const requirementModel = createRequirementModelMock({
      currentRequirement,
      scopedRequirements: [
        { requirementId: 'req-1', status: requirementStatusForReq1 },
        { requirementId: 'req-2', status: 'assigned' },
      ],
    });

    const service = new EiRequirementsService(
      requirementModel as any,
      {} as any,
      createPlanModelMock() as any,
      { githubRequest: jest.fn() } as any,
    );

    return { service, currentRequirement };
  }

  it('blocks moving SHARED_REQ-002 forward when SHARED_REQ-001 is not done in sequential plan', async () => {
    const { service, currentRequirement } = buildService('assigned');

    await expect(
      service.updateRequirementStatus('req-2', {
        status: 'in_progress',
        planId: 'plan-001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(currentRequirement.save).not.toHaveBeenCalled();
  });

  it('allows moving SHARED_REQ-002 forward after SHARED_REQ-001 is done in sequential plan', async () => {
    const { service, currentRequirement } = buildService('done');

    await expect(
      service.updateRequirementStatus('req-2', {
        status: 'in_progress',
        planId: 'plan-001',
      }),
    ).resolves.toBeTruthy();

    expect(currentRequirement.status).toBe('in_progress');
    expect(currentRequirement.save).toHaveBeenCalled();
  });
});
