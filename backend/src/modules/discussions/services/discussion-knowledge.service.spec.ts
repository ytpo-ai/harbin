import {
  extractKeywordTags,
  inferCredibility,
} from './discussion-knowledge.service';
import {
  DiscussionKnowledgeCredibility,
  DiscussionKnowledgeSourceType,
} from '../../../shared/schemas/discussion-knowledge-entry.schema';

describe('discussion knowledge helpers', () => {
  it('extracts frequent keyword tags', () => {
    const tags = extractKeywordTags('energy market volatility energy demand outlook market supply market');
    expect(tags[0]).toBe('market');
    expect(tags).toContain('energy');
  });

  it('marks trusted source as high credibility', () => {
    const credibility = inferCredibility(DiscussionKnowledgeSourceType.WEB_SEARCH, 'https://www.iea.org/reports/test');
    expect(credibility).toBe(DiscussionKnowledgeCredibility.HIGH);
  });

  it('marks user input as unverified', () => {
    const credibility = inferCredibility(DiscussionKnowledgeSourceType.USER_INPUT);
    expect(credibility).toBe(DiscussionKnowledgeCredibility.UNVERIFIED);
  });
});
