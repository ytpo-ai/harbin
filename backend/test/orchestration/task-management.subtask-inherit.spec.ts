import { BadRequestException } from '@nestjs/common';
import { TaskManagementService } from '../../src/modules/orchestration/services/task-management.service';

describe('TaskManagementService development subtask inheritance', () => {
  function createService() {
    return new TaskManagementService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        normalizeRuntimeTaskTypeOverride: (value?: string) => {
          const normalized = String(value || '').trim().toLowerCase();
          if (
            normalized === 'research'
            || normalized === 'development.plan'
            || normalized === 'development.exec'
            || normalized === 'development.review'
            || normalized === 'general'
          ) {
            return normalized;
          }
          return null;
        },
      } as any,
    );
  }

  it('inherits assignment/runtime/taskType/session for development parent', () => {
    const service = createService() as any;
    const result = service.resolveDevelopmentSubtaskInheritance({
      taskType: 'development.exec',
      runtimeTaskType: 'development.exec',
      assignment: { executorType: 'agent', executorId: 'agent-1' },
      sessionId: 'session-123',
    });

    expect(result).toEqual({
      assignment: {
        executorType: 'agent',
        executorId: 'agent-1',
        reason: 'Inherited from parent development task',
      },
      taskType: 'development.exec',
      runtimeTaskType: 'development.exec',
      sessionId: 'session-123',
    });
  });

  it('returns null for non-development parent', () => {
    const service = createService() as any;
    const result = service.resolveDevelopmentSubtaskInheritance({
      taskType: 'general',
      assignment: { executorType: 'agent', executorId: 'agent-1' },
    });

    expect(result).toBeNull();
  });

  it('throws when development parent has no agent assignment', () => {
    const service = createService() as any;

    expect(() => service.resolveDevelopmentSubtaskInheritance({
      taskType: 'development.exec',
      assignment: { executorType: 'unassigned' },
    })).toThrow(BadRequestException);
  });
});
