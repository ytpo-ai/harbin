export function inferDomainTypeFromText(input: {
  prompt?: string;
  preferredDomainType?: string;
}): string {
  const preferred = String(input.preferredDomainType || '').trim().toLowerCase();
  if (preferred) {
    return preferred;
  }

  const text = String(input.prompt || '').toLowerCase();
  const patterns: Array<{ domainType: string; signals: string[] }> = [
    {
      domainType: 'research',
      signals: ['research', 'investigate', 'analysis', '调研', '分析', 'benchmark'],
    },
    {
      domainType: 'product_planning',
      signals: ['prd', 'roadmap', 'product', '需求规划', '产品规划', '用户故事', '产品', '需求'],
    },
    {
      domainType: 'operations',
      signals: ['ops', 'runbook', 'incident', '运维', '值班', '告警'],
    },
    {
      domainType: 'development',
      signals: ['develop', 'code', 'implement', 'bug', 'fix', '重构', '开发', '编码', '修复'],
    },
  ];

  for (const item of patterns) {
    if (item.signals.some((signal) => text.includes(signal))) {
      return item.domainType;
    }
  }

  return 'general';
}
