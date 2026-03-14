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

  it('rejects research output when proof is missing', () => {
    const output = '{"findings":[{"rank":1,"title":"A","summary":"B","source":"https://example.com/a"}]}';
    const result = service.validateResearchOutput(output, 'generic_research');

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing or invalid research execution proof');
  });

  it('extracts email proof marker', () => {
    const output = 'EMAIL_SEND_PROOF: {"recipient":"test@example.com","provider":"smtp","messageId":"id-1"}';
    expect(service.extractEmailSendProof(output).valid).toBe(true);
  });
});
