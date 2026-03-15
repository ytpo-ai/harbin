import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import { Skill } from '../../schemas/skill.schema';

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
    const configuredDataRoot = process.env.AGENT_DATA_ROOT?.trim();
    const dataRoot = configuredDataRoot
      ? path.resolve(path.isAbsolute(configuredDataRoot) ? configuredDataRoot : path.join(root, configuredDataRoot))
      : null;
    const baseDir = dataRoot ? path.join(dataRoot, 'skills') : path.join(root, 'docs', 'skills');
    return {
      root,
      baseDir,
      libraryDir: path.join(baseDir, 'library'),
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

  async rebuildIndex(skills: Skill[]): Promise<void> {
    const { baseDir } = this.getSkillDirs();
    await fs.mkdir(baseDir, { recursive: true });
    const filePath = path.join(baseDir, 'README.md');
    const content = this.renderIndexMarkdown(skills);
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

  private renderIndexMarkdown(skills: Skill[]): string {
    const activeSkills = skills.filter((skill) => skill.status === 'active').length;
    const lines = [
      '# Skills Registry',
      '',
      `- totalSkills: ${skills.length}`,
      `- activeSkills: ${activeSkills}`,
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

    lines.push('');
    return lines.join('\n');
  }

  reportSyncError(error: unknown, message: string): void {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    this.logger.warn(`${message}: ${detail}`);
  }
}
