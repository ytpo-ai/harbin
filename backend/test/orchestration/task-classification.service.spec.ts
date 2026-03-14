import { TaskClassificationService } from '../../src/modules/orchestration/services/task-classification.service';

describe('TaskClassificationService', () => {
  const service = new TaskClassificationService();

  it('detects city population research task kind', () => {
    expect(service.detectResearchTaskKind('Research top 10 cities', 'find population data')).toBe('city_population');
  });

  it('detects review tasks', () => {
    expect(service.isReviewTask('Review outreach email', 'finalize draft')).toBe(true);
  });

  it('detects external email actions', () => {
    expect(service.isExternalActionTask('Send email to team', 'notify release')).toBe(true);
  });
});
