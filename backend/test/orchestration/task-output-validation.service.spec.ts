import { TaskClassificationService } from '../../src/modules/orchestration/services/task-classification.service';
import { TaskOutputValidationService } from '../../src/modules/orchestration/services/task-output-validation.service';

describe('TaskOutputValidationService', () => {
  const classificationService = new TaskClassificationService();
  const service = new TaskOutputValidationService(classificationService);

  it('accepts valid research output with proof', () => {
    const output = [
      '| rank | title | summary | source |',
      '| --- | --- | --- | --- |',
      '| 1 | A | B | https://example.com/a |',
      '| 2 | C | D | https://example.com/c |',
      '| 3 | E | F | https://example.com/e |',
      'RESEARCH_EXECUTION_PROOF: {"toolCalls":["websearch","webfetch"],"fetchedUrls":["https://example.com/a"]}',
    ].join('\n');

    expect(service.validateResearchOutput(output, 'generic_research').valid).toBe(true);
  });

  it('rejects general output with task inability marker', () => {
    const output = 'TASK_INABILITY: missing repo-writer tool in current runtime';
    const result = service.validateGeneralOutput(output);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('agent reported inability to execute task');
  });

  it('rejects general output when task inability marker starts on a new line', () => {
    const output = ['Done with pre-check.', 'TASK_INABILITY: missing web-fetch permission'].join('\n');
    const result = service.validateGeneralOutput(output);

    expect(result.valid).toBe(false);
  });

  it('ignores inability marker outside general validation snippet window', () => {
    const output = `${'x'.repeat(520)}\nTASK_INABILITY: too far from output start`;
    const result = service.validateGeneralOutput(output);

    expect(result.valid).toBe(true);
  });

  it('rejects research output when proof is missing', () => {
    const output = '{"findings":[{"rank":1,"title":"A","summary":"B","source":"https://example.com/a"}]}';
    const result = service.validateResearchOutput(output, 'generic_research');

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing or invalid research execution proof');
  });

  it('rejects research output with expanded inability signals', () => {
    const output = [
      '当前会话没有接入 web-fetch，缺少必要工具。',
      '我这边无法直接访问目标网页，因此不能继续研究。',
      'RESEARCH_EXECUTION_PROOF: {"toolCalls":[],"fetchedUrls":[]}',
    ].join('\n');
    const result = service.validateResearchOutput(output, 'generic_research');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('agent reported inability to access source data');
  });

  it('extracts email proof marker', () => {
    const output = 'EMAIL_SEND_PROOF: {"recipient":"test@example.com","provider":"smtp","messageId":"id-1"}';
    expect(service.extractEmailSendProof(output).valid).toBe(true);
  });
});
