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

/**
 * D2/D9 延迟裁决阈值：
 * 当 run 结束时成功执行的不同工具数 >= 此值，说明是多步工具调用场景，
 * D2（多 tool_call 批量输出）和 D9（纯文本重试）的 pending 扣分予以豁免。
 */
const MULTI_STEP_TOOL_THRESHOLD = 3;

/** 适用延迟裁决的规则 ID */
const DEFERRED_RULE_IDS: ReadonlySet<ScoreRuleId> = new Set(['D2', 'D9']);

export class TaskExecutionScorer {
  private readonly deductions: ScoreDeduction[] = [];
  /** D2/D9 的待定扣分，summarize 时根据实际执行情况决定是否生效 */
  private readonly pendingDeductions: ScoreDeduction[] = [];
  private readonly distinctExecutedToolIds = new Set<string>();
  private maxRoundSeen = -1;
  private totalToolCalls = 0;
  private successfulToolCalls = 0;
  private failedToolCalls = 0;
  private lastToolIdValue?: string;
  /** 上一轮工具调用是否通过了 preflight（true = 实际执行，false = preflight 被拒） */
  private lastToolExecuted = false;

  get lastToolId(): string | undefined {
    return this.lastToolIdValue;
  }

  /** 上一轮工具是否真正执行过（未被 preflight 拒绝） */
  get lastToolWasExecuted(): boolean {
    return this.lastToolExecuted;
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
    // 默认标记为未执行，由外部在工具实际执行成功后调用 markLastToolExecuted()
    this.lastToolExecuted = false;
  }

  /** 标记当前轮工具已实际执行（通过 preflight 并进入执行） */
  markLastToolExecuted(): void {
    this.lastToolExecuted = true;
    if (this.lastToolIdValue) {
      this.distinctExecutedToolIds.add(this.lastToolIdValue);
    }
  }

  trackToolSuccess(): void {
    this.successfulToolCalls += 1;
  }

  trackToolFailure(): void {
    this.failedToolCalls += 1;
  }

  /**
   * 记录扣分。D2/D9 先进入 pending 队列，在 summarize() 时根据实际执行情况裁决；
   * 其他规则立即生效。
   */
  deduct(ruleId: ScoreRuleId, round: number, options?: { toolId?: string; detail?: string }): void {
    const points = AGENT_RUN_SCORE_RULE_POINTS[ruleId];
    const record: ScoreDeduction = {
      ruleId,
      points,
      round,
      toolId: options?.toolId,
      detail: options?.detail,
      timestamp: new Date(),
    };
    if (DEFERRED_RULE_IDS.has(ruleId)) {
      this.pendingDeductions.push(record);
    } else {
      this.deductions.push(record);
    }
  }

  summarize(): TaskExecutionScoreSummary {
    // 延迟裁决：成功执行的不同工具数 < 阈值 → pending 扣分生效，否则豁免
    const isMultiStep = this.distinctExecutedToolIds.size >= MULTI_STEP_TOOL_THRESHOLD;
    const effectiveDeductions = isMultiStep
      ? this.deductions
      : [...this.deductions, ...this.pendingDeductions];

    const deductionsByRule: Record<string, { count: number; totalPoints: number }> = {};
    let deductedPoints = 0;
    for (const item of effectiveDeductions) {
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
      deductions: [...effectiveDeductions],
      ruleVersion: AGENT_RUN_SCORE_RULE_VERSION,
    };
  }
}
