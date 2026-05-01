import {
  buildDataUpdateAnalysisFallbackContent,
  buildBranchContextMessageContent,
  buildDiscussionAgentTaskId,
  resolveDiscussionMessageRole,
  shouldUseDefaultReplyAgent,
} from './discussion-message.service';
import { DiscussionMessageSenderType } from '../../../shared/schemas/discussion-message.schema';

describe('discussion message default reply agent', () => {
  it('returns false when no default agent configured', () => {
    expect(shouldUseDefaultReplyAgent('hello', undefined)).toBe(false);
  });

  it('returns true when default agent exists and message has no explicit mention', () => {
    expect(shouldUseDefaultReplyAgent('请给我一个执行建议', 'participant-ai-1')).toBe(true);
  });

  it('returns false when message has explicit mention', () => {
    expect(shouldUseDefaultReplyAgent('@ResearchBot 请给结论', 'participant-ai-1')).toBe(false);
  });

  it('builds stable task/session id for discussion runtime routing', () => {
    expect(buildDiscussionAgentTaskId('space-1', 'thread-2', 'participant-ai-3')).toBe('discussion-space-1-thread-2-participant-ai-3');
  });

  it('maps discussion sender type to chat role', () => {
    expect(resolveDiscussionMessageRole(DiscussionMessageSenderType.USER)).toBe('user');
    expect(resolveDiscussionMessageRole(DiscussionMessageSenderType.AI)).toBe('assistant');
    expect(resolveDiscussionMessageRole(DiscussionMessageSenderType.SYSTEM)).toBe('system');
  });

  it('builds branch context message content with source metadata', () => {
    const content = buildBranchContextMessageContent({
      parentThreadTitle: '主讨论线',
      sourceSequence: 12,
      sourceContent: '这是被分叉的原始回复',
    });

    expect(content).toContain('主讨论线');
    expect(content).toContain('#12');
    expect(content).toContain('这是被分叉的原始回复');
  });

  it('handles empty source content when building branch context message', () => {
    const content = buildBranchContextMessageContent({
      sourceContent: '   ',
    });

    expect(content).toContain('原讨论线');
    expect(content).toContain('该消息');
    expect(content).toContain('分叉来源消息为空');
  });

  it('builds fallback data update analysis content', () => {
    const content = buildDataUpdateAnalysisFallbackContent({
      sourceName: 'DeFiLlama TVL',
      dataCategory: 'market_data',
      collectedAt: '2026-05-01T10:00:00.000Z',
      changePercent: 12.3456,
      currentData: { value: 150, unit: 'B USD' },
      previousData: { value: 133.5, unit: 'B USD' },
    });

    expect(content).toContain('DeFiLlama TVL');
    expect(content).toContain('market_data');
    expect(content).toContain('12.35%');
    expect(content).toContain('当前数据');
    expect(content).toContain('历史基线');
  });
});
