export function normalizeSystemContent(content: string): string {
  return String(content || '').replace(/\s+/g, ' ').trim();
}

export function buildSystemContextKey(content: string): string | null {
  const normalized = normalizeSystemContent(content);
  if (!normalized) return null;

  if (normalized.startsWith('团队上下文:') || normalized.startsWith('协作上下文:')) {
    return `collab:${normalized}`;
  }

  const meetingTitleMatch = normalized.match(/^你正在参加一个会议，会议标题是"([^"]+)"。?/);
  if (meetingTitleMatch?.[1]) {
    return `meeting_brief:${meetingTitleMatch[1]}`;
  }

  return null;
}
