import {
  buildReusableKnowledgeFilter,
  extractKeywordTags,
  inferCredibility,
  resolveOutlineSectionStatusByKnowledgeCount,
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

  it('excludes discussion-derived knowledge by default for reusable hints', () => {
    const filter = buildReusableKnowledgeFilter('space-1', { topicTags: ['energy'] });
    expect(filter.sourceType).toEqual({ $ne: DiscussionKnowledgeSourceType.DISCUSSION_DERIVED });
    expect(filter.$or).toEqual([{ topicTags: { $in: ['energy'] } }, { keywordTags: { $in: ['energy'] } }]);
  });

  it('can include discussion-derived knowledge when explicitly enabled', () => {
    const filter = buildReusableKnowledgeFilter('space-1', { includeDerived: true });
    expect(filter.sourceType).toBeUndefined();
  });

  it('keeps review status when syncing outline progress', () => {
    const status = resolveOutlineSectionStatusByKnowledgeCount(10, 'review');
    expect(status).toBe('review');
  });

  it('marks section as sufficient when knowledge count reaches threshold', () => {
    const status = resolveOutlineSectionStatusByKnowledgeCount(5, 'draft');
    expect(status).toBe('sufficient');
  });

  it('marks section as enriching for partial coverage', () => {
    const status = resolveOutlineSectionStatusByKnowledgeCount(2, 'draft');
    expect(status).toBe('enriching');
  });
});
