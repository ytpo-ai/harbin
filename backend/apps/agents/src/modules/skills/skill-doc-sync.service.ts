import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import { Skill } from '../../schemas/skill.schema';
import { SkillSuggestion } from '../../schemas/skill-suggestion.schema';

@Injectable()
export class SkillDocSyncService {
  private readonly logger = new Logger(SkillDocSyncService.name);

  private resolveWorkspaceRoot(): string {
    const cwd = process.cwd();
    const candidates = [cwd, path.resolve(cwd, '..'), path.resolve(cwd, '../..')];
    for (const candidate of candidates) {
      const docsPath = path.join(candidate, 'docs');
      if (existsSync(docsPath)) {
        return candidate;
      }
    }
    return cwd;
  }

  private getSkillDirs() {
    const root = this.resolveWorkspaceRoot();
    return {
      root,
      baseDir: path.join(root, 'docs', 'skills'),
      libraryDir: path.join(root, 'docs', 'skills', 'library'),
      suggestionDir: path.join(root, 'docs', 'skills', 'suggestions'),
    };
  }

  async syncSkill(skill: Skill): Promise<void> {
    const { libraryDir } = this.getSkillDirs();
    await fs.mkdir(libraryDir, { recursive: true });
    const filePath = path.join(libraryDir, `${skill.slug}.md`);
    const content = this.renderSkillMarkdown(skill);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async removeSkill(skillSlug: string): Promise<void> {
    const { libraryDir } = this.getSkillDirs();
    const filePath = path.join(libraryDir, `${skillSlug}.md`);
    try {
      await fs.unlink(filePath);
    } catch {
      return;
    }
  }

  async syncSuggestion(suggestion: SkillSuggestion, skill?: Skill): Promise<void> {
    const { suggestionDir } = this.getSkillDirs();
    await fs.mkdir(suggestionDir, { recursive: true });
    const filePath = path.join(suggestionDir, `${suggestion.id}.md`);
    const content = this.renderSuggestionMarkdown(suggestion, skill);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async rebuildIndex(skills: Skill[], suggestions: SkillSuggestion[]): Promise<void> {
    const { baseDir } = this.getSkillDirs();
    await fs.mkdir(baseDir, { recursive: true });
    const filePath = path.join(baseDir, 'README.md');
    const content = this.renderIndexMarkdown(skills, suggestions);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  private renderSkillMarkdown(skill: Skill): string {
    const tags = (skill.tags || []).join(', ');
    return [
      `# Skill: ${skill.name}`,
      '',
      `- id: \`${skill.id}\``,
      `- slug: \`${skill.slug}\``,
      `- category: ${skill.category || 'general'}`,
      `- status: ${skill.status}`,
      `- version: ${skill.version}`,
      `- provider: ${skill.provider}`,
      `- sourceType: ${skill.sourceType}`,
      `- sourceUrl: ${skill.sourceUrl || 'N/A'}`,
      `- confidenceScore: ${skill.confidenceScore ?? 50}`,
      `- discoveredBy: ${skill.discoveredBy || 'AgentSkillManager'}`,
      `- tags: ${tags || 'N/A'}`,
      `- updatedAt: ${skill.updatedAt ? new Date(skill.updatedAt).toISOString() : new Date().toISOString()}`,
      '',
      '## Description',
      '',
      skill.description || 'N/A',
      '',
    ].join('\n');
  }

  private renderSuggestionMarkdown(suggestion: SkillSuggestion, skill?: Skill): string {
    return [
      `# Skill Suggestion: ${suggestion.id}`,
      '',
      `- agentId: \`${suggestion.agentId}\``,
      `- skillId: \`${suggestion.skillId}\``,
      `- skillName: ${skill?.name || 'N/A'}`,
      `- priority: ${suggestion.priority}`,
      `- status: ${suggestion.status}`,
      `- score: ${suggestion.score ?? 50}`,
      `- suggestedBy: ${suggestion.suggestedBy || 'AgentSkillManager'}`,
      `- reviewedAt: ${suggestion.reviewedAt ? new Date(suggestion.reviewedAt).toISOString() : 'N/A'}`,
      `- appliedAt: ${suggestion.appliedAt ? new Date(suggestion.appliedAt).toISOString() : 'N/A'}`,
      '',
      '## Reason',
      '',
      suggestion.reason,
      '',
    ].join('\n');
  }

  private renderIndexMarkdown(skills: Skill[], suggestions: SkillSuggestion[]): string {
    const activeSkills = skills.filter((skill) => skill.status === 'active').length;
    const pendingSuggestions = suggestions.filter((item) => item.status === 'pending').length;
    const lines = [
      '# Skills Registry',
      '',
      `- totalSkills: ${skills.length}`,
      `- activeSkills: ${activeSkills}`,
      `- totalSuggestions: ${suggestions.length}`,
      `- pendingSuggestions: ${pendingSuggestions}`,
      '',
      '## Skill Library',
      '',
    ];

    if (!skills.length) {
      lines.push('- No skills yet.');
    } else {
      for (const skill of skills) {
        lines.push(`- [${skill.name}](./library/${skill.slug}.md) - ${skill.status} - ${skill.category}`);
      }
    }

    lines.push('', '## Suggestions', '');
    if (!suggestions.length) {
      lines.push('- No suggestions yet.');
    } else {
      for (const suggestion of suggestions.slice(0, 30)) {
        lines.push(
          `- [${suggestion.id}](./suggestions/${suggestion.id}.md) - agent=${suggestion.agentId} - status=${suggestion.status} - priority=${suggestion.priority}`,
        );
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  reportSyncError(error: unknown, message: string): void {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    this.logger.warn(`${message}: ${detail}`);
  }
}
