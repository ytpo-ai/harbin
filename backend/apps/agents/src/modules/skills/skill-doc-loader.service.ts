import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import { PlanningRule, SkillSourceType, SkillStatus } from '../../schemas/agent-skill.schema';

export interface LoadedSkillDoc {
  filePath: string;
  slug?: string;
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  sourceType?: SkillSourceType;
  sourceUrl?: string;
  provider?: string;
  version?: string;
  status?: SkillStatus;
  confidenceScore?: number;
  discoveredBy?: string;
  metadata?: Record<string, any>;
  planningRules?: PlanningRule[];
  content?: string;
  contentType: string;
  contentHash?: string;
  contentSize: number;
}

@Injectable()
export class SkillDocLoaderService {
  private readonly logger = new Logger(SkillDocLoaderService.name);

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

  private resolveSkillDocsDir(): string {
    const root = this.resolveWorkspaceRoot();
    const configuredDir = process.env.SKILL_DOCS_DIR?.trim();
    if (!configuredDir) {
      return path.join(root, 'docs', 'skill');
    }
    return path.resolve(path.isAbsolute(configuredDir) ? configuredDir : path.join(root, configuredDir));
  }

  async loadDocs(): Promise<LoadedSkillDoc[]> {
    const docsDir = this.resolveSkillDocsDir();
    if (!existsSync(docsDir)) {
      this.logger.warn(`Skill docs directory does not exist: ${docsDir}`);
      return [];
    }
    const entries = await fs.readdir(docsDir, { withFileTypes: true });
    const markdownFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => path.join(docsDir, entry.name))
      .sort((left, right) => left.localeCompare(right));
    const loaded: LoadedSkillDoc[] = [];

    for (const filePath of markdownFiles) {
      const parsed = await this.parseSkillDoc(filePath);
      if (parsed) {
        loaded.push(parsed);
      }
    }

    return loaded;
  }

  private async parseSkillDoc(filePath: string): Promise<LoadedSkillDoc | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const { frontmatter, content } = this.splitFrontmatter(raw);
      const doc = this.toLoadedSkillDoc(filePath, frontmatter, content);
      return doc;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to parse skill doc ${filePath}: ${message}`);
      return null;
    }
  }

  private splitFrontmatter(raw: string): { frontmatter: Record<string, any>; content: string } {
    const normalized = raw.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    if (lines[0]?.trim() !== '---') {
      return { frontmatter: {}, content: normalized.trim() };
    }

    let closingIndex = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        closingIndex = i;
        break;
      }
    }
    if (closingIndex < 0) {
      return { frontmatter: {}, content: normalized.trim() };
    }

    const frontmatterLines = lines.slice(1, closingIndex);
    const contentLines = lines.slice(closingIndex + 1);
    return {
      frontmatter: this.parseYamlLike(frontmatterLines),
      content: contentLines.join('\n').trim(),
    };
  }

  private parseYamlLike(lines: string[]): Record<string, any> {
    const normalized = lines.map((line) => line.replace(/\t/g, '  '));
    const { value } = this.parseBlock(normalized, 0, 0);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }
    return {};
  }

  private parseBlock(lines: string[], start: number, indent: number): { value: any; nextIndex: number } {
    let index = start;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim() || line.trimStart().startsWith('#')) {
        index += 1;
        continue;
      }
      const lineIndent = this.countIndent(line);
      if (lineIndent < indent) {
        return { value: {}, nextIndex: index };
      }
      if (line.trimStart().startsWith('- ')) {
        return this.parseArray(lines, index, indent);
      }
      return this.parseObject(lines, index, indent);
    }
    return { value: {}, nextIndex: index };
  }

  private parseObject(lines: string[], start: number, indent: number): { value: Record<string, any>; nextIndex: number } {
    const result: Record<string, any> = {};
    let index = start;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }
      const lineIndent = this.countIndent(line);
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        index += 1;
        continue;
      }
      if (trimmed.startsWith('- ')) break;

      const separator = trimmed.indexOf(':');
      if (separator <= 0) {
        index += 1;
        continue;
      }
      const key = trimmed.slice(0, separator).trim();
      const rest = trimmed.slice(separator + 1).trim();
      if (!rest) {
        const nested = this.parseBlock(lines, index + 1, indent + 2);
        result[key] = nested.value;
        index = nested.nextIndex;
        continue;
      }
      result[key] = this.parseScalar(rest);
      index += 1;
    }

    return { value: result, nextIndex: index };
  }

  private parseArray(lines: string[], start: number, indent: number): { value: any[]; nextIndex: number } {
    const result: any[] = [];
    let index = start;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        index += 1;
        continue;
      }
      const lineIndent = this.countIndent(line);
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        index += 1;
        continue;
      }
      if (!trimmed.startsWith('- ')) break;

      const rest = trimmed.slice(2).trim();
      if (!rest) {
        const nested = this.parseBlock(lines, index + 1, indent + 2);
        result.push(nested.value);
        index = nested.nextIndex;
        continue;
      }

      // YAML spec: inline key-value in array requires ": " (colon + space).
      // Plain colons without trailing space (e.g. "domainType:development:must")
      // must be preserved as scalar strings.
      const inlineSeparator = rest.indexOf(': ');
      if (inlineSeparator > 0) {
        const key = rest.slice(0, inlineSeparator).trim();
        const valuePart = rest.slice(inlineSeparator + 2).trim();
        const item: Record<string, any> = {};
        if (valuePart) {
          item[key] = this.parseScalar(valuePart);
          const tail = this.parseObject(lines, index + 1, indent + 2);
          result.push({ ...item, ...tail.value });
          index = tail.nextIndex;
          continue;
        }
        const nested = this.parseBlock(lines, index + 1, indent + 2);
        item[key] = nested.value;
        result.push(item);
        index = nested.nextIndex;
        continue;
      }

      result.push(this.parseScalar(rest));
      index += 1;
    }

    return { value: result, nextIndex: index };
  }

  private parseScalar(value: string): any {
    const normalized = value.trim();
    if (!normalized.length) return '';

    if (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
      return normalized.slice(1, -1);
    }

    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    if (normalized === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(normalized)) {
      return Number(normalized);
    }

    return normalized;
  }

  private countIndent(line: string): number {
    const match = line.match(/^\s*/);
    return match ? match[0].length : 0;
  }

  private toLoadedSkillDoc(filePath: string, frontmatter: Record<string, any>, content: string): LoadedSkillDoc {
    const contentHash = content ? createHash('sha256').update(content).digest('hex') : undefined;
    const metadata = frontmatter.metadata && typeof frontmatter.metadata === 'object'
      ? { ...(frontmatter.metadata as Record<string, any>) }
      : {};
    const tags = this.normalizeStringArray(frontmatter.tags)
      || this.normalizeStringArray(metadata.tags)
      || undefined;
    const planningRules = this.normalizePlanningRules(frontmatter.planningRules);

    return {
      filePath,
      slug: this.normalizeOptionalString(frontmatter.slug),
      name: this.normalizeOptionalString(frontmatter.name),
      description: this.normalizeOptionalString(frontmatter.description),
      category: this.normalizeOptionalString(frontmatter.category),
      tags,
      sourceType: this.normalizeSourceType(frontmatter.sourceType),
      sourceUrl: this.normalizeOptionalString(frontmatter.sourceUrl),
      provider: this.normalizeOptionalString(frontmatter.provider),
      version: this.normalizeOptionalString(frontmatter.version),
      status: this.normalizeStatus(frontmatter.status),
      confidenceScore: this.normalizeOptionalNumber(frontmatter.confidenceScore),
      discoveredBy: this.normalizeOptionalString(frontmatter.discoveredBy),
      metadata,
      planningRules,
      content: content || undefined,
      contentType: this.normalizeOptionalString(frontmatter.contentType) || 'text/markdown',
      contentHash,
      contentSize: content ? Buffer.byteLength(content, 'utf8') : 0,
    };
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized.length ? normalized : undefined;
  }

  private normalizeOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
      return Number(value.trim());
    }
    return undefined;
  }

  private normalizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const normalized = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return normalized.length ? Array.from(new Set(normalized)) : undefined;
  }

  private normalizeSourceType(value: unknown): SkillSourceType | undefined {
    if (value !== 'manual' && value !== 'github' && value !== 'web' && value !== 'internal') {
      return undefined;
    }
    return value;
  }

  private normalizeStatus(value: unknown): SkillStatus | undefined {
    if (value !== 'active' && value !== 'experimental' && value !== 'deprecated' && value !== 'disabled') {
      return undefined;
    }
    return value;
  }

  private normalizePlanningRules(value: unknown): PlanningRule[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const normalized: PlanningRule[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const type = this.normalizeOptionalString((item as any).type);
      const rule = this.normalizeOptionalString((item as any).rule);
      const validate = this.normalizeOptionalString((item as any).validate);
      if (!type || !rule) continue;
      normalized.push({
        type: type as PlanningRule['type'],
        rule,
        ...(validate ? { validate } : {}),
      });
    }
    return normalized.length ? normalized : undefined;
  }
}
