import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import { AgentMemo } from '../../schemas/agent-memo.schema';

@Injectable()
export class MemoDocSyncService {
  private readonly logger = new Logger(MemoDocSyncService.name);

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

  private getMemoDirs(agentId?: string, category?: string) {
    const root = this.resolveWorkspaceRoot();
    const baseDir = path.join(root, 'docs', 'memos');
    const agentDir = agentId ? path.join(baseDir, this.normalizeSegment(agentId)) : baseDir;
    const categoryDir = category ? path.join(agentDir, this.normalizeSegment(category)) : agentDir;
    return { root, baseDir, agentDir, categoryDir };
  }

  async syncMemo(memo: AgentMemo): Promise<void> {
    const { categoryDir } = this.getMemoDirs(memo.agentId, memo.category);
    await fs.mkdir(categoryDir, { recursive: true });
    const filePath = path.join(categoryDir, `${memo.slug}.md`);
    await fs.writeFile(filePath, this.renderMemoMarkdown(memo), 'utf8');
  }

  async removeMemo(memo: AgentMemo): Promise<void> {
    const { categoryDir } = this.getMemoDirs(memo.agentId, memo.category);
    const filePath = path.join(categoryDir, `${memo.slug}.md`);
    try {
      await fs.unlink(filePath);
    } catch {
      return;
    }
  }

  async rebuildIndex(memos: AgentMemo[]): Promise<void> {
    const { baseDir } = this.getMemoDirs();
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, 'README.md'), this.renderIndexMarkdown(memos), 'utf8');
  }

  private renderMemoMarkdown(memo: AgentMemo): string {
    const tags = (memo.tags || []).join(', ');
    const keywords = (memo.contextKeywords || []).join(', ');
    return [
      `# Memo: ${memo.title}`,
      '',
      `- id: \`${memo.id}\``,
      `- agentId: \`${memo.agentId}\``,
      `- category: ${memo.category}`,
      `- type: ${memo.memoType}`,
      `- kind: ${memo.memoKind || 'topic'}`,
      `- topic: ${memo.topic || 'N/A'}`,
      `- todoStatus: ${memo.todoStatus || 'N/A'}`,
      `- taskId: ${memo.taskId || 'N/A'}`,
      `- source: ${memo.source || 'agent'}`,
      `- tags: ${tags || 'N/A'}`,
      `- contextKeywords: ${keywords || 'N/A'}`,
      `- accessCount: ${memo.accessCount || 0}`,
      `- updatedAt: ${memo.updatedAt ? new Date(memo.updatedAt).toISOString() : new Date().toISOString()}`,
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
          `- [${memo.title}](./${this.normalizeSegment(memo.agentId)}/${this.normalizeSegment(memo.category)}/${memo.slug}.md) - ${memo.memoKind || 'topic'} - ${memo.memoType} - ${memo.category} - ${memo.todoStatus || 'n/a'}`,
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
