import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '@libs/infra';
import { SYSTEM_CONTEXT_FINGERPRINT_TTL_SECONDS, compactLogText } from '../agent.constants';
import { IdentityMemoSnapshotItem, SystemContextFingerprintRecord, TaskInfoSnapshot } from '../agent.types';

@Injectable()
export class ContextFingerprintService {
  constructor(private readonly redisService: RedisService) {}

  resolveSystemContextScope(
    agent: { id?: string; _id?: { toString?: () => string } },
    task: { id?: string; title?: string; type?: string; teamId?: string },
    context?: {
      collaborationContext?: Record<string, unknown>;
      sessionContext?: Record<string, unknown>;
    },
  ): string {
    const agentId = String(agent.id || agent._id?.toString?.() || 'unknown').trim() || 'unknown';
    const collaborationContext = (context?.collaborationContext || {}) as Record<string, unknown>;
    const sessionContext = (context?.sessionContext || {}) as Record<string, unknown>;

    const meetingId = String(collaborationContext?.meetingId || '').trim();
    if (meetingId) {
      return `meeting:${meetingId}:agent:${agentId}`;
    }
    const sessionId = String(collaborationContext?.sessionId || sessionContext?.sessionId || '').trim();
    if (sessionId) {
      return `session:${sessionId}:agent:${agentId}`;
    }
    const taskId = String(task.id || '').trim();
    if (taskId) {
      return `task:${taskId}:agent:${agentId}`;
    }
    return `ephemeral:${agentId}:${this.hashFingerprint(`${task.title || ''}|${task.type || ''}|${task.teamId || ''}`)}`;
  }

  hashFingerprint(input: string): string {
    return createHash('sha256').update(String(input || '')).digest('hex');
  }

  async resolveSystemContextBlockContent(options: {
    scope: string;
    blockType: string;
    fullContent: string;
    snapshot: unknown;
    buildDelta?: (previous: unknown, current: unknown) => string;
    deltaPrefix?: string;
    /** 跳过去重判断，始终返回 fullContent（仅更新缓存）。
     *  用于没有 session 缓存保底的场景（如 meeting），避免 fingerprint 命中后返回 null 导致系统提示丢失。 */
    skipDedup?: boolean;
  }): Promise<string | null> {
    const fullContent = String(options.fullContent || '').trim();
    if (!fullContent) {
      return null;
    }

    const normalizedSnapshot = (options.snapshot || {}) as Record<string, unknown>;
    const fingerprint = this.hashFingerprint(JSON.stringify(normalizedSnapshot));
    const key = this.systemContextFingerprintCacheKey(options.scope, options.blockType);
    const nextRecord: SystemContextFingerprintRecord = {
      fingerprint,
      snapshot: normalizedSnapshot,
      updatedAt: new Date().toISOString(),
    };

    try {
      const cached = await this.redisService.get(key);
      if (cached) {
        const parsed = JSON.parse(cached) as SystemContextFingerprintRecord;
        if (parsed?.fingerprint === fingerprint) {
          // 没有 session 缓存保底时，即使 fingerprint 命中也必须返回完整内容，否则系统提示会丢失。
          if (options.skipDedup) {
            return fullContent;
          }
          return null;
        }

        if (options.buildDelta && parsed?.snapshot) {
          const delta = String(options.buildDelta(parsed.snapshot, normalizedSnapshot) || '').trim();
          if (delta) {
            await this.redisService.set(key, JSON.stringify(nextRecord), SYSTEM_CONTEXT_FINGERPRINT_TTL_SECONDS);
            return options.deltaPrefix ? `${options.deltaPrefix}\n${delta}` : delta;
          }
        }
      }

      await this.redisService.set(key, JSON.stringify(nextRecord), SYSTEM_CONTEXT_FINGERPRINT_TTL_SECONDS);
      return fullContent;
    } catch {
      return fullContent;
    }
  }

  buildTaskInfoDelta(previous: TaskInfoSnapshot, current: TaskInfoSnapshot): string {
    const changes: string[] = [];
    if (previous.title !== current.title) {
      changes.push(`- 标题：${previous.title || '（空）'} -> ${current.title || '（空）'}`);
    }
    if (previous.description !== current.description) {
      changes.push(
        `- 描述：${compactLogText(previous.description, 120) || '（空）'} -> ${compactLogText(current.description, 120) || '（空）'}`,
      );
    }
    if (previous.type !== current.type) {
      changes.push(`- 类型：${previous.type || '（空）'} -> ${current.type || '（空）'}`);
    }
    if (previous.priority !== current.priority) {
      changes.push(`- 优先级：${previous.priority || '（空）'} -> ${current.priority || '（空）'}`);
    }
    return changes.join('\n');
  }

  buildIdentityMemoDelta(previous: IdentityMemoSnapshotItem[], current: IdentityMemoSnapshotItem[]): string {
    const toMap = (items: IdentityMemoSnapshotItem[]) =>
      new Map(items.map((item) => [`${item.title}::${item.topic}`, item]));
    const previousMap = toMap(previous || []);
    const currentMap = toMap(current || []);

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];

    for (const [key, next] of currentMap.entries()) {
      const prev = previousMap.get(key);
      const label = next.topic ? `${next.title} (${next.topic})` : next.title;
      if (!prev) {
        added.push(label);
        continue;
      }
      if (prev.contentHash !== next.contentHash) {
        updated.push(label);
      }
    }

    for (const [key, prev] of previousMap.entries()) {
      if (currentMap.has(key)) continue;
      removed.push(prev.topic ? `${prev.title} (${prev.topic})` : prev.title);
    }

    const lines: string[] = [];
    if (added.length) lines.push(`- 新增：${added.join('、')}`);
    if (updated.length) lines.push(`- 更新：${updated.join('、')}`);
    if (removed.length) lines.push(`- 移除：${removed.join('、')}`);
    return lines.join('\n');
  }

  private systemContextFingerprintCacheKey(scope: string, blockType: string): string {
    return `agent:system-context-fingerprint:${scope}:${blockType}`;
  }
}
