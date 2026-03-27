import { Injectable } from '@nestjs/common';

export type ResearchTaskKind = 'city_population' | 'generic_research';

@Injectable()
export class TaskOutputValidationService {
  private readonly generalInabilitySignalPatterns: RegExp[] = [
    /(?:^|\n)\s*task_inability\s*:/i,
    /\b(?:cannot execute|unable to complete|cannot complete|i cannot perform|unable to access|cannot browse)\b/i,
    /\b(?:i don't have|i do not have|missing tool|lack the ability|not equipped|don't have direct access)\b/i,
    /(?:无法执行|无法完成|无法按|我没有|缺少工具|没有可用的|无法直接|不具备|无法访问|无法浏览|我这边无法|当前会话没有|没有接入)/u,
  ];

  private readonly researchInabilitySignalPatterns: RegExp[] = [
    ...this.generalInabilitySignalPatterns,
    /缺少.{0,8}工具/u,
    /(?:无法|不能|不可).{0,16}(?:访问|浏览|抓取|检索|获取)/u,
  ];

  buildResearchOutputContract(kind: ResearchTaskKind): string {
    if (kind === 'city_population') {
      return [
        'Research output contract (MUST follow one format):',
        'Preferred JSON format:',
        '{"cities":[{"rank":1,"city":"Shanghai","population":"24870000","year":2023,"source":"https://..."}]}',
        'Execution proof (REQUIRED):',
        'RESEARCH_EXECUTION_PROOF: {"toolCalls":["websearch","webfetch","content_extract"],"fetchedUrls":["https://...","https://..."]}',
        'Requirements:',
        '- exactly 10 cities in descending population order',
        '- each item must include city and population',
        '- include source URL whenever available',
      ].join('\n');
    }

    return [
      'Research output contract (MUST follow one format):',
      'Preferred JSON format:',
      '{"findings":[{"rank":1,"title":"...","summary":"...","source":"https://..."}]}',
      'Execution proof (REQUIRED):',
      'RESEARCH_EXECUTION_PROOF: {"toolCalls":["websearch","webfetch"],"fetchedUrls":["https://...","https://..."]}',
      'Requirements:',
      '- at least 3 findings',
      '- each finding includes title/summary/source',
      '- source should be URL',
    ].join('\n');
  }

  validateCodeExecutionProof(
    runtimeTaskType: string | undefined,
    output: string,
  ): { valid: boolean; reason?: string; missing?: string[] } {
    const normalizedTaskType = String(runtimeTaskType || '').trim().toLowerCase();
    if (!normalizedTaskType.startsWith('development.')) {
      return { valid: true };
    }

    const text = String(output || '');
    const lower = text.toLowerCase();
    const hasBuild = /\b(npm run build|pnpm build|yarn build|bun run build|build\b)\b/i.test(text);
    const hasTest = /\b(npm test|pnpm test|yarn test|bun test|pytest|go test|vitest|jest|test\b)\b/i.test(text);
    const hasLint = /\b(npm run lint|pnpm lint|yarn lint|bun run lint|ruff check|eslint|lint\b)\b/i.test(text);
    const hasSuccessSignal =
      /\b(exit code\s*:?\s*0|completed successfully|success|passed|all checks passed|0 failed)\b/i.test(text) ||
      (!/\b(exit code\s*:?\s*[1-9]|error:|failed|exception)\b/i.test(text) && lower.length > 0);
    const hasDiffSignal =
      /\b(git diff|files changed|changed files|modified:|create mode|insertions\(|deletions\()\b/i.test(text);

    const missing: string[] = [];
    if (!(hasBuild || hasTest || hasLint)) missing.push('build/test/lint commands');
    if (!hasSuccessSignal) missing.push('successful command exit evidence');
    if (!hasDiffSignal) missing.push('code change evidence');

    if (missing.length > 0) {
      return {
        valid: false,
        reason: `missing ${missing.join(', ')}`,
        missing,
      };
    }

    return { valid: true };
  }

  validateGeneralOutput(output: string): { valid: boolean; reason?: string; missing?: string[] } {
    const text = (output || '').trim();
    if (!text) {
      return { valid: false, reason: 'empty output', missing: ['content'] };
    }

    const matchedSignal = this.findInabilitySignal(text, this.generalInabilitySignalPatterns, 500);
    if (matchedSignal) {
      return {
        valid: false,
        reason: `agent reported inability to execute task (${matchedSignal})`,
        missing: ['executable-result'],
      };
    }

    return { valid: true };
  }

  validateResearchOutput(
    output: string,
    kind: ResearchTaskKind,
  ): { valid: boolean; reason?: string; missing?: string[] } {
    const text = (output || '').trim();
    if (!text) {
      return { valid: false, reason: 'empty output', missing: ['content'] };
    }

    const matchedSignal = this.findInabilitySignal(text, this.researchInabilitySignalPatterns, 1200);
    if (matchedSignal) {
      return {
        valid: false,
        reason: `agent reported inability to access source data (${matchedSignal})`,
        missing: ['usable-research-result'],
      };
    }

    const evidenceValidation = this.validateResearchExecutionProof(text);
    if (!evidenceValidation.valid) {
      return {
        valid: false,
        reason: 'missing or invalid research execution proof',
        missing: evidenceValidation.missing,
      };
    }

    const jsonValidation = this.validateResearchJson(text);
    if (jsonValidation.valid && this.validateKindSpecificJson(jsonValidation.parsed, kind)) {
      return { valid: true };
    }

    const tableValidation = this.validateResearchTable(text);
    if (tableValidation.valid && this.validateKindSpecificTable(text, kind)) {
      return { valid: true };
    }

    const listValidation = this.validateResearchNumberedList(text);
    if (listValidation.valid && this.validateKindSpecificList(text, kind)) {
      return { valid: true };
    }

    const mergedMissing = Array.from(
      new Set([...(jsonValidation.missing || []), ...(tableValidation.missing || []), ...(listValidation.missing || [])]),
    );
    return {
      valid: false,
      reason:
        kind === 'city_population'
          ? 'missing top-10 structured city list with population figures'
          : 'missing structured research findings with source links',
      missing:
        mergedMissing.length > 0
          ? mergedMissing
          : kind === 'city_population'
            ? ['top10-list', 'population-values']
            : ['findings-list', 'source-links'],
    };
  }

  validateReviewOutput(output: string): { valid: boolean; reason?: string; missing?: string[] } {
    return this.validateGeneralOutput(output);
  }

  private validateResearchJson(text: string): { valid: boolean; missing?: string[]; parsed?: any } {
    const parsed = this.tryParseJson(text);
    if (!parsed) {
      return { valid: false, missing: ['json-structure'] };
    }

    const cities = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.cities)
        ? parsed.cities
        : Array.isArray(parsed.items)
          ? parsed.items
          : [];

    const findings = Array.isArray(parsed.findings)
      ? parsed.findings
      : Array.isArray(parsed.results)
        ? parsed.results
        : [];

    if (cities.length === 0 && findings.length === 0 && !Array.isArray(parsed)) {
      return { valid: false, missing: ['json-items'] };
    }

    return { valid: true, parsed };
  }

  private validateResearchTable(text: string): { valid: boolean; missing?: string[] } {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const tableRows = lines.filter((line) => line.includes('|') && /\|/.test(line));
    if (tableRows.length < 4) {
      return { valid: false, missing: ['markdown-table-rows'] };
    }
    return { valid: true };
  }

  private validateResearchNumberedList(text: string): { valid: boolean; missing?: string[] } {
    const numberedLines = text.match(/(^|\n)\s*(\d+\.|[-*])\s*.*$/g) || [];
    if (numberedLines.length < 4) {
      return { valid: false, missing: ['numbered-list-items'] };
    }
    return { valid: true };
  }

  private validateResearchExecutionProof(text: string): { valid: boolean; missing?: string[] } {
    const markerMatch = text.match(/RESEARCH_EXECUTION_PROOF\s*:\s*(\{[\s\S]*?\})/i);
    if (!markerMatch?.[1]) {
      return { valid: false, missing: ['research-execution-proof'] };
    }

    try {
      const parsed = JSON.parse(markerMatch[1]);
      const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls.map((item: unknown) => String(item)) : [];
      const fetchedUrls = Array.isArray(parsed.fetchedUrls) ? parsed.fetchedUrls.map((item: unknown) => String(item)) : [];
      const hasWebSearch = toolCalls.includes('websearch');
      const hasWebFetch = toolCalls.includes('webfetch');
      const validUrls = fetchedUrls.filter((url) => /^https?:\/\//i.test(url));
      const missing: string[] = [];
      if (!hasWebSearch) missing.push('proof-websearch-call');
      if (!hasWebFetch) missing.push('proof-webfetch-call');
      if (validUrls.length < 1) missing.push('proof-fetched-urls');

      return { valid: missing.length === 0, missing };
    } catch {
      return { valid: false, missing: ['proof-json-parse'] };
    }
  }

  private validateKindSpecificJson(parsed: any, kind: ResearchTaskKind): boolean {
    if (kind === 'city_population') {
      const cities = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.cities)
          ? parsed.cities
          : [];
      if (cities.length < 10) return false;
      return cities.slice(0, 10).every((item: any) => item?.city && item?.population);
    }

    const findings = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.findings)
        ? parsed.findings
        : Array.isArray(parsed?.items)
          ? parsed.items
          : [];
    if (findings.length < 3) return false;
    return findings.slice(0, 3).every((item: any) => item?.title && item?.summary && item?.source);
  }

  private validateKindSpecificTable(text: string, kind: ResearchTaskKind): boolean {
    const lower = text.toLowerCase();
    if (kind === 'city_population') {
      const hasCityColumn = lower.includes('city');
      const hasPopulationColumn = lower.includes('population');
      return hasCityColumn && hasPopulationColumn;
    }
    const hasTitleColumn = lower.includes('title') || lower.includes('finding');
    const hasSourceColumn = lower.includes('source');
    return hasTitleColumn && hasSourceColumn;
  }

  private validateKindSpecificList(text: string, kind: ResearchTaskKind): boolean {
    if (kind === 'city_population') {
      const hasPopulationFigures = /(\d{1,3}(,\d{3})+|\d+\s*(million|bn|billion|万|亿))/i.test(text);
      return hasPopulationFigures;
    }

    return /(https?:\/\/)/i.test(text);
  }

  private tryParseJson(content: string): any | null {
    const trimmed = (content || '').trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1] || trimmed.match(/```\s*([\s\S]*?)```/i)?.[1];
      if (fenced) {
        try {
          return JSON.parse(fenced.trim());
        } catch {
          return null;
        }
      }
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private findInabilitySignal(text: string, patterns: RegExp[], limit: number): string | null {
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 500;
    const snippet = String(text || '').slice(0, normalizedLimit);
    for (const pattern of patterns) {
      if (pattern.test(snippet)) {
        return pattern.source;
      }
    }
    return null;
  }
}
