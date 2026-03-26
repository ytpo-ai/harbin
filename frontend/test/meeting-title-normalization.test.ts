import { describe, expect, it } from 'bun:test';
import {
  getMeetingDisplayDescription,
  getMeetingDisplayTitle,
  isDuplicateMeetingDescription,
  normalizeMeetingTitle,
} from '../src/pages/meetings/utils';

describe('meeting title normalization', () => {
  it('normalizes active one-to-one title and keeps status independent', () => {
    expect(normalizeMeetingTitle('与 Kim-CTO 的1对1聊天 进行中')).toBe('与 Kim-CTO 的1对1聊天');
    expect(getMeetingDisplayTitle('与 Kim-CTO 的1对1聊天 进行中', '与 Agent Kim-CTO 的直接会话')).toBe('与 Kim-CTO 的1对1聊天');
  });

  it('normalizes ended one-to-one title and strips status suffix', () => {
    expect(normalizeMeetingTitle('与 Kim-CTO 的1对1聊天 已结束')).toBe('与 Kim-CTO 的1对1聊天');
  });

  it('keeps manual title as the highest-priority display title', () => {
    expect(getMeetingDisplayTitle('  每周业务复盘  ', '与 Agent Kim-CTO 的直接会话')).toBe('每周业务复盘');
  });

  it('uses a single fallback title when both title and description are empty', () => {
    expect(getMeetingDisplayTitle('   ', '  ')).toBe('未命名会议');
  });

  it('deduplicates semantically equivalent one-to-one title and description', () => {
    expect(isDuplicateMeetingDescription('与  Kim-CTO 的1对1聊天', '与 Agent   Kim-CTO 的直接会话')).toBe(true);
    expect(getMeetingDisplayDescription('与  Kim-CTO 的1对1聊天', '与 Agent   Kim-CTO 的直接会话')).toBe('');
  });

  it('keeps non-duplicate descriptions', () => {
    expect(getMeetingDisplayDescription('项目周会', '讨论 Q2 里程碑')).toBe('讨论 Q2 里程碑');
  });
});
