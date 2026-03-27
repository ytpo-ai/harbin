import { TaskOutputValidationService } from '../../src/modules/orchestration/services/task-output-validation.service';

describe('TaskOutputValidationService', () => {
  const service = new TaskOutputValidationService();

  it('accepts generic executable output', () => {
    const result = service.validateGeneralOutput('Implemented API endpoint and verified response payload.');
    expect(result.valid).toBe(true);
  });

  it('rejects output with task inability marker', () => {
    const output = 'TASK_INABILITY: missing repo-writer tool in current runtime';
    const result = service.validateGeneralOutput(output);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('agent reported inability to execute task');
  });
});
