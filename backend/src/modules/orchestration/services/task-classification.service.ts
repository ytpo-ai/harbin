import { Injectable } from '@nestjs/common';

export type ResearchTaskKind = 'city_population' | 'generic_research';

@Injectable()
export class TaskClassificationService {
  isExternalActionTask(title: string, description: string): boolean {
    return this.isEmailTask(title, description);
  }

  isEmailTask(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();
    return (
      text.includes('send email') ||
      text.includes('email to') ||
      text.includes('发送邮件') ||
      text.includes('发邮件') ||
      text.includes('gmail') ||
      text.includes('@')
    );
  }

  isResearchTask(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();
    return (
      text.includes('research') ||
      text.includes('search') ||
      text.includes('compile') ||
      text.includes('population') ||
      text.includes('most populous') ||
      text.includes('调研') ||
      text.includes('检索') ||
      text.includes('汇总')
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

  detectResearchTaskKind(title: string, description: string): ResearchTaskKind | null {
    const text = `${title} ${description}`.toLowerCase();
    const isResearchLike =
      text.includes('research') ||
      text.includes('search') ||
      text.includes('compile') ||
      text.includes('investigate') ||
      text.includes('identify') ||
      text.includes('collection') ||
      text.includes('collect') ||
      text.includes('gather') ||
      text.includes('analyze') ||
      text.includes('analysis') ||
      text.includes('data source') ||
      text.includes('dataset') ||
      text.includes('调研') ||
      text.includes('检索') ||
      text.includes('汇总') ||
      text.includes('识别') ||
      text.includes('收集') ||
      text.includes('分析') ||
      text.includes('数据源');

    if (!isResearchLike) {
      return null;
    }

    const isCityPopulation =
      text.includes('most populous') ||
      text.includes('population') ||
      text.includes('top 10 cities') ||
      text.includes('中国人口最多') ||
      text.includes('城市人口');

    return isCityPopulation ? 'city_population' : 'generic_research';
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
