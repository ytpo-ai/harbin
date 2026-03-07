export interface CodeUpdatesMcpCommit {
  hash: string;
  shortHash: string;
  author: string;
  committedAt: string;
  subject: string;
  files: string[];
}

export interface CodeUpdatesMcpSummary {
  title: string;
  details: string;
  whatChanged: string[];
  whyItMatters: string;
  evidenceFiles: string[];
  severity: 'high' | 'medium' | 'low';
  commits: string[];
  impactedModules: string[];
}

interface ScoredCommit {
  commit: CodeUpdatesMcpCommit;
  impactedModules: string[];
  whatChanged: string[];
  whyItMatters: string;
  evidenceFiles: string[];
  severity: 'high' | 'medium' | 'low';
  severityScore: number;
  themeKey: string;
}

const NOISE_KEYWORDS = ['chore', 'format', 'lint', 'prettier', 'typo'];

function isNoiseSubject(subject: string): boolean {
  const lowered = (subject || '').toLowerCase();
  return NOISE_KEYWORDS.some((item) => lowered.includes(item));
}

function detectModule(filePath: string): string {
  const normalized = (filePath || '').replace(/^\//, '');
  if (normalized.startsWith('backend/apps/agents/')) return 'agents-service';
  if (normalized.startsWith('backend/apps/gateway/')) return 'gateway-service';
  if (normalized.startsWith('backend/apps/engineering-intelligence/')) return 'engineering-intelligence';
  if (normalized.startsWith('backend/')) return 'backend-core';
  if (normalized.startsWith('frontend/')) return 'frontend';
  if (normalized.startsWith('docs/')) return 'documentation';
  return 'other';
}

function collectImpactedModules(files: string[]): string[] {
  return Array.from(new Set((files || []).map((file) => detectModule(file)))).slice(0, 6);
}

function inferHighlights(subject: string, files: string[]): string[] {
  const highlights: string[] = [];
  const loweredSubject = (subject || '').toLowerCase();

  if (files.some((file) => file.includes('backend/apps/agents/src/modules/agents/agent.service.ts'))) {
    highlights.push('增强 Agent 执行链路与问答路由逻辑');
  }
  if (files.some((file) => file.includes('backend/apps/agents/src/modules/tools/tool.service.ts'))) {
    highlights.push('扩展 MCP 工具注册与执行能力');
  }
  if (
    files.some((file) => file.includes('backend/libs/models/src/openai-provider.ts')) ||
    files.some((file) => file.includes('backend/libs/models/src/v1/openai-provider.ts'))
  ) {
    highlights.push('增强模型调用稳定性（超时/重试策略）');
  }
  if (files.some((file) => file.startsWith('backend/apps/engineering-intelligence/'))) {
    highlights.push('扩展研发智能后端能力');
  }
  if (files.some((file) => file.startsWith('frontend/'))) {
    highlights.push('更新前端页面或交互能力');
  }
  if (files.some((file) => file.startsWith('docs/')) || files.some((file) => file === 'README.md')) {
    highlights.push('同步更新文档与使用说明');
  }
  if (loweredSubject.includes('fix')) {
    highlights.push('修复现有功能问题并提升稳定性');
  }
  if (loweredSubject.includes('feat')) {
    highlights.push('新增功能或能力入口');
  }

  if (!highlights.length) {
    highlights.push('常规工程更新（以提交与文件证据为准）');
  }
  return Array.from(new Set(highlights)).slice(0, 4);
}

function inferWhyItMatters(impactedModules: string[], highlights: string[]): string {
  if (highlights.some((item) => item.includes('稳定性'))) {
    return '降低运行超时与失败概率，提升问答链路可用性。';
  }
  if (impactedModules.includes('agents-service')) {
    return '直接影响 Agent 的任务执行与回答质量。';
  }
  if (impactedModules.includes('frontend')) {
    return '直接影响用户交互体验与可见功能。';
  }
  if (impactedModules.includes('documentation')) {
    return '提升功能可追踪性与团队协作效率。';
  }
  return '改善系统能力一致性与交付可维护性。';
}

function scoreSeverity(subject: string, impactedModules: string[], files: string[]): { score: number; severity: 'high' | 'medium' | 'low' } {
  let score = 0;
  const lowered = (subject || '').toLowerCase();

  if (lowered.includes('feat') || lowered.includes('fix')) score += 2;
  if (impactedModules.includes('agents-service') || impactedModules.includes('backend-core')) score += 2;
  if (impactedModules.includes('frontend')) score += 1;
  if (files.length >= 5) score += 1;
  if (isNoiseSubject(subject)) score -= 2;

  if (score >= 4) return { score, severity: 'high' };
  if (score >= 2) return { score, severity: 'medium' };
  return { score, severity: 'low' };
}

function detectThemeKey(subject: string, highlights: string[], impactedModules: string[]): string {
  const loweredSubject = (subject || '').toLowerCase();
  const joinedHighlights = highlights.join(' ');

  if (loweredSubject.includes('code-docs-mcp') || joinedHighlights.includes('MCP 工具注册')) {
    return 'cto-doc-capability';
  }
  if (loweredSubject.includes('code-updates-mcp') || loweredSubject.includes('updates mcp')) {
    return 'cto-updates-capability';
  }
  if (joinedHighlights.includes('模型调用稳定性')) {
    return 'model-stability';
  }
  if (impactedModules.includes('agents-service')) {
    return 'agents-runtime';
  }
  if (impactedModules.includes('engineering-intelligence')) {
    return 'engineering-intelligence';
  }
  if (impactedModules.includes('frontend')) {
    return 'frontend';
  }
  if (impactedModules.includes('documentation')) {
    return 'documentation';
  }
  return 'general';
}

function themeTitle(themeKey: string): string {
  switch (themeKey) {
    case 'cto-doc-capability':
      return 'CTO 文档能力增强';
    case 'cto-updates-capability':
      return 'CTO 更新追踪能力增强';
    case 'model-stability':
      return '模型调用稳定性优化';
    case 'agents-runtime':
      return 'Agent 运行链路优化';
    case 'engineering-intelligence':
      return '研发智能能力扩展';
    case 'frontend':
      return '前端交互与页面更新';
    case 'documentation':
      return '文档与规范同步';
    default:
      return '常规工程更新';
  }
}

export const buildCodeUpdatesMcpSummary = {
  summarize(commits: CodeUpdatesMcpCommit[], options: { limit: number; minSeverity: 'high' | 'medium' | 'low' }): {
    majorUpdates: CodeUpdatesMcpSummary[];
    unknownBoundary: string[];
  } {
    const minSeverityScore = options.minSeverity === 'high' ? 4 : options.minSeverity === 'medium' ? 2 : 0;
    const sorted = [...commits]
      .sort((a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime())
      .slice(0, Math.max(1, Math.min(options.limit, 30)));

    const scoredCommits: ScoredCommit[] = sorted
      .map((commit) => {
        const impactedModules = collectImpactedModules(commit.files);
        const whatChanged = inferHighlights(commit.subject, commit.files);
        const whyItMatters = inferWhyItMatters(impactedModules, whatChanged);
        const evidenceFiles = (commit.files || []).slice(0, 5);
        const { score, severity } = scoreSeverity(commit.subject, impactedModules, commit.files || []);
        const themeKey = detectThemeKey(commit.subject, whatChanged, impactedModules);
        return {
          commit,
          impactedModules,
          whatChanged,
          whyItMatters,
          evidenceFiles,
          severity,
          severityScore: score,
          themeKey,
        };
      })
      .filter((item) => item.severityScore >= minSeverityScore);

    const grouped = new Map<string, ScoredCommit[]>();
    for (const row of scoredCommits) {
      const existing = grouped.get(row.themeKey) || [];
      existing.push(row);
      grouped.set(row.themeKey, existing);
    }

    const majorUpdates = Array.from(grouped.entries())
      .map(([key, rows]) => {
        const first = rows[0];
        const allCommits = rows.map((item) => item.commit.hash);
        const impactedModules = Array.from(new Set(rows.flatMap((item) => item.impactedModules))).slice(0, 6);
        const whatChanged = Array.from(new Set(rows.flatMap((item) => item.whatChanged))).slice(0, 4);
        const evidenceFiles = Array.from(new Set(rows.flatMap((item) => item.evidenceFiles))).slice(0, 6);
        const severity: 'high' | 'medium' | 'low' = rows.some((item) => item.severity === 'high')
          ? 'high'
          : rows.some((item) => item.severity === 'medium')
            ? 'medium'
            : 'low';
        const details = `包含 ${rows.length} 次提交，涉及 ${evidenceFiles.length} 个关键文件，重点模块：${impactedModules.join('、') || 'other'}`;
        const whyItMatters = rows[0]?.whyItMatters || inferWhyItMatters(impactedModules, whatChanged);
        const maxScore = Math.max(...rows.map((item) => item.severityScore));
        return {
          title: themeTitle(key),
          details,
          whatChanged,
          whyItMatters,
          evidenceFiles,
          severity,
          commits: allCommits,
          impactedModules,
          sortScore: maxScore,
          latestAt: first?.commit.committedAt || '',
        };
      })
      .sort((a, b) => {
        if (b.sortScore !== a.sortScore) return b.sortScore - a.sortScore;
        return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
      })
      .slice(0, options.limit)
      .map(({ sortScore, latestAt, ...rest }) => rest);

    const unknownBoundary: string[] = [];
    if (!majorUpdates.length) {
      unknownBoundary.push('指定时间窗口内未检索到满足主要更新阈值的提交记录。');
    }

    return {
      majorUpdates,
      unknownBoundary,
    };
  },
};
