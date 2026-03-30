import { Injectable } from '@nestjs/common';

@Injectable()
export class TaskOutputValidationService {
  private readonly generalInabilitySignalPatterns: RegExp[] = [
    /(?:^|\n)\s*task_inability\s*:/i,
    /\b(?:cannot execute|unable to complete|cannot complete|i cannot perform|unable to access|cannot browse)\b/i,
    /\b(?:i don't have|i do not have|missing tool|lack the ability|not equipped|don't have direct access)\b/i,
    /(?:无法执行|无法完成|无法按|我没有|缺少工具|没有可用的|无法直接|不具备|无法访问|无法浏览|我这边无法|当前会话没有|没有接入)/u,
  ];

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
