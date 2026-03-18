import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import { AgentMemo } from '../../schemas/agent-memo.schema';

@Injectable()
export class MemoDocSyncService {
  private readonly logger = new Logger(MemoDocSyncService.name);
  private readonly fileSyncEnabled = String(process.env.MEMO_FILE_SYNC_ENABLED || 'false').toLowerCase() === 'true';

  isFileSyncEnabled(): boolean {
    return this.fileSyncEnabled;
  }

  private resolveWorkspaceRoot(): string {
    const cwd = process.cwd();
    const candidates = [cwd, path.resolve(cwd, '..'), path.resolve(cwd, '../..')];
    for (const candidate of candidates) {
      if (existsSync(path.join(candidate, 'docs'))) {
        return candidate;
      }
    }
    return cwd;
  }

  private getMemoDirs(agentId?: string, memoKind?: string) {
    const root = this.resolveWorkspaceRoot();
    const configuredDataRoot = process.env.AGENT_DATA_ROOT?.trim();
    const dataRoot = configuredDataRoot
      ? path.resolve(path.isAbsolute(configuredDataRoot) ? configuredDataRoot : path.join(root, configuredDataRoot))
      : null;
    const baseDir = dataRoot ? path.join(dataRoot, 'memos') : path.join(root, 'docs', 'memos');
    const agentDir = agentId ? path.join(baseDir, this.normalizeSegment(agentId)) : baseDir;
    const kindDir = memoKind ? path.join(agentDir, this.normalizeSegment(memoKind)) : agentDir;
    return { root, baseDir, agentDir, kindDir };
  }

  async syncMemo(memo: AgentMemo): Promise<void> {
    if (!this.fileSyncEnabled) return;
    const { kindDir } = this.getMemoDirs(memo.agentId, memo.memoKind);
    await fs.mkdir(kindDir, { recursive: true });
    const filePath = path.join(kindDir, `${memo.slug}.md`);
    await fs.writeFile(filePath, this.renderMemoMarkdown(memo), 'utf8');
  }

  async removeMemo(memo: AgentMemo): Promise<void> {
    if (!this.fileSyncEnabled) return;
    const { kindDir } = this.getMemoDirs(memo.agentId, memo.memoKind);
    const filePath = path.join(kindDir, `${memo.slug}.md`);
    try {
      await fs.unlink(filePath);
    } catch {
      return;
    }
  }

  async rebuildIndex(memos: AgentMemo[]): Promise<void> {
    if (!this.fileSyncEnabled) return;
    const { baseDir } = this.getMemoDirs();
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, 'README.md'), this.renderIndexMarkdown(memos), 'utf8');
  }

  private renderMemoMarkdown(memo: AgentMemo): string {
    const payload = memo.payload || {};
    const payloadText = Object.keys(payload).length ? JSON.stringify(payload, null, 2) : 'N/A';
    const tags = (memo.tags || []).join(', ');
    const keywords = (memo.contextKeywords || []).join(', ');
    return [
      `# Memo: ${memo.title}`,
      '',
      `- id: \`${memo.id}\``,
      `- agentId: \`${memo.agentId}\``,
      `- version: ${memo.version || 1}`,
      `- type: ${memo.memoType}`,
      `- kind: ${memo.memoKind || 'topic'}`,
      `- source: ${memo.source || 'agent'}`,
      `- tags: ${tags || 'N/A'}`,
      `- contextKeywords: ${keywords || 'N/A'}`,
      `- updatedAt: ${memo.updatedAt ? new Date(memo.updatedAt).toISOString() : new Date().toISOString()}`,
      '',
      '## Payload',
      '',
      '```json',
      payloadText,
      '```',
      '',
      '## Content',
      '',
      memo.content || 'N/A',
      '',
    ].join('\n');
  }

  private renderIndexMarkdown(memos: AgentMemo[]): string {
    const grouped = new Map<string, AgentMemo[]>();
    for (const memo of memos) {
      const key = memo.agentId;
      const list = grouped.get(key) || [];
      list.push(memo);
      grouped.set(key, list);
    }

    const lines = ['# Agent Memos Registry', '', `- totalMemos: ${memos.length}`, ''];
    if (!memos.length) {
      lines.push('- No memos yet.', '');
      return lines.join('\n');
    }

    for (const [agentId, items] of grouped.entries()) {
      lines.push(`## Agent: ${agentId}`, '');
      for (const memo of items.slice(0, 200)) {
        lines.push(
          `- [${memo.title}](./${this.normalizeSegment(memo.agentId)}/${this.normalizeSegment(memo.memoKind || 'topic')}/${memo.slug}.md) - ${memo.memoKind || 'topic'} - ${memo.memoType} - v${memo.version || 1}`,
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private normalizeSegment(value: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  reportSyncError(error: unknown, message: string): void {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    this.logger.warn(`${message}: ${detail}`);
  }
}
