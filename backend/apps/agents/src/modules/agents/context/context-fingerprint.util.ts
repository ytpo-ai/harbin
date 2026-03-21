import { createHash } from 'crypto';

export function normalizeSystemContent(content: string): string {
  return String(content || '').replace(/\s+/g, ' ').trim();
}

function hashKey(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function buildSystemContextKey(content: string): string | null {
  const normalized = normalizeSystemContent(content);
  if (!normalized) return null;

  if (
    normalized.startsWith('协作上下文(') ||
    normalized.startsWith('协作上下文:') ||
    normalized.startsWith('团队上下文:')
  ) {
    return `collab:${hashKey(normalized)}`;
  }

  const meetingTitleMatch = normalized.match(/^你正在参加一个会议，会议标题是"([^"]+)"。?/);
  if (meetingTitleMatch?.[1]) {
    return `meeting_brief:${meetingTitleMatch[1]}`;
  }

  if (normalized.startsWith('【身份与职责】') || normalized.startsWith('【身份与职责增量更新】')) {
    return `identity_memo:${hashKey(normalized)}`;
  }

  if (normalized.startsWith('业务领域上下文:')) {
    return `domain:${hashKey(normalized)}`;
  }

  if (normalized.startsWith('任务信息:') || normalized.startsWith('任务信息增量更新')) {
    return `task_info:${hashKey(normalized)}`;
  }

  if (normalized.includes('当你需要调用工具时')) {
    return `tool_injection:${hashKey(normalized)}`;
  }

  if (normalized.startsWith('工具使用策略（')) {
    return `tool_strategy:${hashKey(normalized)}`;
  }

  if (normalized.startsWith('Enabled Skills for this agent')) {
    return `skill_index:${hashKey(normalized)}`;
  }

  if (normalized.startsWith('工作记忆（历史运行摘要）')) {
    return `run_summaries:${hashKey(normalized)}`;
  }

  if (normalized.startsWith('以下是从备忘录中按需检索到的相关记忆') || normalized.startsWith('从备忘录中按需检索到的相关记忆')) {
    return `memo_recall:${hashKey(normalized)}`;
  }

  return null;
}
