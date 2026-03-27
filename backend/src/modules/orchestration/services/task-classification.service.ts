import { Injectable } from '@nestjs/common';

export type ResearchTaskKind = 'city_population' | 'generic_research';

@Injectable()
export class TaskClassificationService {
  isResearchTask(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();

    // 如果 task 已通过 planner 显式指定了 runtimeTaskType（如 development/general），
    // 这里的分类只作为 fallback；planner 指定的 taskType 优先级更高。
    // 因此关键词需要精确，避免误将非研究任务分类为 research。
    return (
      text.includes('research') ||
      text.includes('web search') ||
      text.includes('compile a list') ||
      text.includes('compile information') ||
      text.includes('population') ||
      text.includes('most populous') ||
      text.includes('调研') ||
      text.includes('市场调查') ||
      text.includes('信息检索')
    );
  }

  isReviewTask(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();
    return (
      text.includes('review') ||
      text.includes('finalize') ||
      text.includes('revise') ||
      text.includes('proofread') ||
      text.includes('edit draft') ||
      text.includes('校对') ||
      text.includes('复核') ||
      text.includes('润色') ||
      text.includes('修订')
    );
  }

  isCodeTask(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();
    return (
      text.includes('code') ||
      text.includes('implement') ||
      text.includes('开发') ||
      text.includes('编码') ||
      text.includes('修复') ||
      text.includes('fix') ||
      text.includes('refactor')
    );
  }
}
