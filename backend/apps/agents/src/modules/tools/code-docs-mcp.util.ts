export interface CodeDocsMcpEvidence {
  path: string;
  line: number;
  excerpt: string;
}

export interface CodeDocsMcpFeatureCandidate {
  title: string;
  summary: string;
  evidence: CodeDocsMcpEvidence;
}

interface CodeDocsMcpSummaryOptions {
  query?: string;
  maxFeatures: number;
  maxEvidencePerFeature: number;
}

const EXCLUDED_KEYWORDS = ['已下线', '移除', '待重构', 'future', '未来规划'];

const FEATURE_BUCKETS: Array<{ key: string; label: string; keywords: string[] }> = [
  { key: 'agent', label: 'Agent 管理与协作', keywords: ['agent', '团队协作', '创始团队', '协作模式'] },
  { key: 'model', label: '多模型管理', keywords: ['模型', 'openai', 'anthropic', 'gemini', 'model mcp'] },
  { key: 'tooling', label: '工具调用与MCP扩展', keywords: ['工具', 'mcp', 'tool', '调用'] },
  { key: 'meeting', label: '会议与沟通体系', keywords: ['会议', 'meeting', '消息', '会话'] },
  { key: 'hr', label: 'HR与绩效评估', keywords: ['hr', '绩效', '招聘', '团队健康度'] },
  { key: 'engineering-intelligence', label: '研发智能与文档能力', keywords: ['研发智能', 'docs', '文档', 'engineering intelligence'] },
  { key: 'orchestration', label: '任务编排中台', keywords: ['任务', '编排', 'orchestration', 'session'] },
  { key: 'skill', label: 'Skill 管理中台', keywords: ['skill', '技能', '能力增强'] },
];

function normalizeText(text: string): string {
  return text
    .replace(/`/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineHasExcludedKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return EXCLUDED_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function extractCheckedItem(line: string): string | null {
  const matched = line.match(/^\s*[-*]\s*\[x\]\s+(.+)$/i);
  return matched ? normalizeText(matched[1]) : null;
}

function extractBoldBullet(line: string): { title: string; summary: string } | null {
  const matched = line.match(/^\s*[-*]\s*(?:[^\p{L}\p{N}]\s*)?\*\*(.+?)\*\*\s*[-:：]\s*(.+)$/u);
  if (!matched) return null;
  return {
    title: normalizeText(matched[1]),
    summary: normalizeText(matched[2]),
  };
}

function normalizeHeading(line: string): string | null {
  const matched = line.match(/^\s{0,3}#{2,4}\s+(.+)$/);
  return matched ? normalizeText(matched[1]) : null;
}

function inferBucketKey(input: string): string {
  const lowered = input.toLowerCase();
  for (const bucket of FEATURE_BUCKETS) {
    if (bucket.keywords.some((keyword) => lowered.includes(keyword.toLowerCase()))) {
      return bucket.key;
    }
  }
  return `custom:${normalizeText(input).toLowerCase()}`;
}

export const buildCodeDocsMcpSummary = {
  collectCandidatesFromMarkdown(content: string, path: string): CodeDocsMcpFeatureCandidate[] {
    const lines = content.split(/\r?\n/);
    const result: CodeDocsMcpFeatureCandidate[] = [];
    let currentHeading = '';

    lines.forEach((line, index) => {
      const heading = normalizeHeading(line);
      if (heading) {
        currentHeading = heading;
        return;
      }

      const checkedItem = extractCheckedItem(line);
      if (checkedItem && !lineHasExcludedKeyword(checkedItem)) {
        result.push({
          title: checkedItem,
          summary: currentHeading || checkedItem,
          evidence: {
            path,
            line: index + 1,
            excerpt: checkedItem,
          },
        });
        return;
      }

      const boldBullet = extractBoldBullet(line);
      if (boldBullet && !lineHasExcludedKeyword(`${boldBullet.title} ${boldBullet.summary}`)) {
        result.push({
          title: boldBullet.title,
          summary: boldBullet.summary,
          evidence: {
            path,
            line: index + 1,
            excerpt: `${boldBullet.title} - ${boldBullet.summary}`,
          },
        });
      }
    });

    return result;
  },

  summarizeFeatures(candidates: CodeDocsMcpFeatureCandidate[], options: CodeDocsMcpSummaryOptions): {
    features: Array<{
      name: string;
      summary: string;
      confidence: 'high' | 'medium';
      evidence: CodeDocsMcpEvidence[];
    }>;
    unknownBoundary: string[];
  } {
    const normalizedQuery = normalizeText(options.query || '').toLowerCase();
    const queryKeywords = normalizedQuery
      .split(/[^\p{L}\p{N}]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2);

    const grouped = new Map<
      string,
      {
        label: string;
        summaries: Set<string>;
        evidence: CodeDocsMcpEvidence[];
      }
    >();

    for (const candidate of candidates) {
      const mergedText = `${candidate.title} ${candidate.summary}`.toLowerCase();
      if (queryKeywords.length && !queryKeywords.some((keyword) => mergedText.includes(keyword))) {
        continue;
      }

      const bucketKey = inferBucketKey(mergedText);
      const bucket = FEATURE_BUCKETS.find((item) => item.key === bucketKey);
      const label = bucket?.label || candidate.title;

      const existing = grouped.get(bucketKey) || {
        label,
        summaries: new Set<string>(),
        evidence: [],
      };
      existing.summaries.add(candidate.summary || candidate.title);
      existing.evidence.push(candidate.evidence);
      grouped.set(bucketKey, existing);
    }

    const features = Array.from(grouped.values())
      .map((item) => {
        const uniquePaths = new Set(item.evidence.map((evidence) => evidence.path));
        return {
          name: item.label,
          summary: Array.from(item.summaries).slice(0, 2).join('；'),
          confidence: uniquePaths.size >= 2 ? ('high' as const) : ('medium' as const),
          evidence: item.evidence.slice(0, options.maxEvidencePerFeature),
          score: item.evidence.length,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, options.maxFeatures)
      .map(({ score, ...rest }) => rest);

    const unknownBoundary: string[] = [];
    if (!features.length) {
      unknownBoundary.push('在当前 docs 中未检索到与提问直接匹配的核心功能描述。');
    }

    return {
      features,
      unknownBoundary,
    };
  },
};
