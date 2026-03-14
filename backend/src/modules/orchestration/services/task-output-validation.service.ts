import { Injectable } from '@nestjs/common';
import { ResearchTaskKind, TaskClassificationService } from './task-classification.service';

@Injectable()
export class TaskOutputValidationService {
  constructor(private readonly taskClassificationService: TaskClassificationService) {}

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

  extractEmailSendProof(output: string): { valid: boolean; recipient?: string; provider?: string; messageId?: string } {
    const text = output || '';
    const markerMatch = text.match(/EMAIL_SEND_PROOF\s*:\s*(\{[\s\S]*?\})/i);
    if (markerMatch?.[1]) {
      try {
        const parsed = JSON.parse(markerMatch[1]);
        const recipient = String(parsed.recipient || '');
        const provider = String(parsed.provider || '');
        const messageId = String(parsed.messageId || '');
        if (recipient.includes('@') && provider && messageId) {
          return { valid: true, recipient, provider, messageId };
        }
      } catch {
        // ignore and fallback to heuristic
      }
    }

    const hasRecipient = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text);
    const hasProvider = /gmail|smtp|mailgun|ses|sendgrid|outlook/i.test(text);
    const hasMessageId = /message[\s_-]?id\s*[:=]/i.test(text) || /queued\s+as\s+/i.test(text);

    return {
      valid: hasRecipient && hasProvider && hasMessageId,
    };
  }

  validateCodeExecutionProof(
    title: string,
    description: string,
    output: string,
  ): { valid: boolean; reason?: string; missing?: string[] } {
    if (!this.taskClassificationService.isCodeTask(title, description)) {
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

  validateResearchOutput(
    output: string,
    kind: ResearchTaskKind,
  ): { valid: boolean; reason?: string; missing?: string[] } {
    const text = (output || '').trim();
    if (!text) {
      return { valid: false, reason: 'empty output', missing: ['content'] };
    }

    const lower = text.toLowerCase();
    const inabilitySignals = [
      'cannot browse',
      'unable to access',
      "don't have direct access",
      '无法访问',
      '无法直接访问',
      '无法浏览',
    ];
    if (inabilitySignals.some((signal) => lower.includes(signal))) {
      return {
        valid: false,
        reason: 'agent reported inability to access source data',
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
    const text = (output || '').trim();
    if (!text) {
      return { valid: false, reason: 'empty review output', missing: ['email-content'] };
    }

    const lower = text.toLowerCase();
    const askForDraftSignals = ['please provide', 'provide the draft', '请提供草稿'];
    if (askForDraftSignals.some((signal) => lower.includes(signal))) {
      return {
        valid: false,
        reason: 'review output asks user for draft instead of providing revised email',
        missing: ['final-revised-email'],
      };
    }

    const suggestionOnlySignals = ['suggestion', 'you might consider', 'could be improved', '建议如下'];
    const hasSubject = /(subject\s*:|主题\s*[:：])/i.test(text);
    const hasGreeting = /(dear\s+|hi\s+|hello\s+|尊敬的|您好)/i.test(text);
    const hasClosing = /(best regards|regards|sincerely|thanks|此致|敬礼|祝好)/i.test(text);
    const bodyLengthEnough = text.length >= 220;

    const missing: string[] = [];
    if (!hasSubject) missing.push('subject-line');
    if (!hasGreeting) missing.push('greeting');
    if (!hasClosing) missing.push('closing-signature');
    if (!bodyLengthEnough) missing.push('full-body-content');

    if (missing.length > 0) {
      return {
        valid: false,
        reason: 'review output is not a complete revised email',
        missing,
      };
    }

    if (suggestionOnlySignals.some((signal) => lower.includes(signal)) && !hasSubject) {
      return {
        valid: false,
        reason: 'review output contains suggestions only',
        missing: ['final-revised-email'],
      };
    }

    return { valid: true };
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
}
