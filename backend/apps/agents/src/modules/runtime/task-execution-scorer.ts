export type ScoreRuleId =
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'D5'
  | 'D6'
  | 'D7'
  | 'D8'
  | 'D9'
  | 'D10'
  | 'D11'
  | 'D12';

export const AGENT_RUN_SCORE_RULE_VERSION = '1.0';
export const AGENT_RUN_SCORE_BASE = 100;

export const AGENT_RUN_SCORE_RULE_POINTS: Record<ScoreRuleId, number> = {
  D1: -5,
  D2: -8,
  D3: -10,
  D4: -8,
  D5: -5,
  D6: -10,
  D7: -3,
  D8: -5,
  D9: -5,
  D10: -3,
  D11: -15,
  D12: -2,
};

export interface ScoreDeduction {
  ruleId: ScoreRuleId;
  points: number;
  round: number;
  toolId?: string;
  detail?: string;
  timestamp: Date;
}

export interface TaskExecutionScoreSummary {
  score: number;
  baseScore: number;
  totalDeductions: number;
  stats: {
    totalRounds: number;
    totalToolCalls: number;
    successfulToolCalls: number;
    failedToolCalls: number;
  };
  deductionsByRule: Record<string, { count: number; totalPoints: number }>;
  deductions: ScoreDeduction[];
  ruleVersion: string;
}

export class TaskExecutionScorer {
  private readonly deductions: ScoreDeduction[] = [];
  private maxRoundSeen = -1;
  private totalToolCalls = 0;
  private successfulToolCalls = 0;
  private failedToolCalls = 0;
  private lastToolIdValue?: string;

  get lastToolId(): string | undefined {
    return this.lastToolIdValue;
  }

  markRound(round: number): void {
    if (Number.isFinite(round) && round > this.maxRoundSeen) {
      this.maxRoundSeen = round;
    }
  }

  trackToolCall(toolId: string): void {
    if (!toolId) {
      return;
    }
    this.totalToolCalls += 1;
    this.lastToolIdValue = toolId;
  }

  trackToolSuccess(): void {
    this.successfulToolCalls += 1;
  }

  trackToolFailure(): void {
    this.failedToolCalls += 1;
  }

  deduct(ruleId: ScoreRuleId, round: number, options?: { toolId?: string; detail?: string }): void {
    const points = AGENT_RUN_SCORE_RULE_POINTS[ruleId];
    this.deductions.push({
      ruleId,
      points,
      round,
      toolId: options?.toolId,
      detail: options?.detail,
      timestamp: new Date(),
    });
  }

  summarize(): TaskExecutionScoreSummary {
    const deductionsByRule: Record<string, { count: number; totalPoints: number }> = {};
    let deductedPoints = 0;
    for (const item of this.deductions) {
      deductedPoints += Math.abs(item.points);
      if (!deductionsByRule[item.ruleId]) {
        deductionsByRule[item.ruleId] = {
          count: 0,
          totalPoints: 0,
        };
      }
      deductionsByRule[item.ruleId].count += 1;
      deductionsByRule[item.ruleId].totalPoints += item.points;
    }

    return {
      score: Math.max(0, AGENT_RUN_SCORE_BASE - deductedPoints),
      baseScore: AGENT_RUN_SCORE_BASE,
      totalDeductions: deductedPoints,
      stats: {
        totalRounds: this.maxRoundSeen + 1,
        totalToolCalls: this.totalToolCalls,
        successfulToolCalls: this.successfulToolCalls,
        failedToolCalls: this.failedToolCalls,
      },
      deductionsByRule,
      deductions: [...this.deductions],
      ruleVersion: AGENT_RUN_SCORE_RULE_VERSION,
    };
  }
}
