import { TaskExecutionScorer, AGENT_RUN_SCORE_RULE_POINTS } from './task-execution-scorer';

describe('TaskExecutionScorer', () => {
  it('applies all v1 deduction rules and computes summary', () => {
    const scorer = new TaskExecutionScorer();

    scorer.markRound(0);
    scorer.markRound(1);
    scorer.markRound(2);

    scorer.deduct('D1', 0, { toolId: 'tool.a' });
    scorer.deduct('D2', 0, { toolId: 'tool.b' });
    scorer.trackToolCall('tool.c');
    scorer.deduct('D3', 1, { toolId: 'tool.c' });
    scorer.trackToolSuccess();
    scorer.trackToolCall('tool.d');
    scorer.trackToolFailure();
    scorer.deduct('D4', 1, { toolId: 'tool.d' });
    scorer.deduct('D5', 1, { toolId: 'tool.e' });
    scorer.deduct('D6', 1, { toolId: 'tool.f' });
    scorer.deduct('D7', 2);
    scorer.deduct('D8', 2);
    scorer.deduct('D9', 2);
    scorer.deduct('D10', 2);
    scorer.deduct('D11', 2);
    scorer.deduct('D12', 2);

    const summary = scorer.summarize();

    const expectedTotalDeduction = Object.values(AGENT_RUN_SCORE_RULE_POINTS)
      .reduce((sum, points) => sum + Math.abs(points), 0);

    expect(summary.baseScore).toBe(100);
    expect(summary.totalDeductions).toBe(expectedTotalDeduction);
    expect(summary.score).toBe(Math.max(0, 100 - expectedTotalDeduction));
    expect(summary.stats.totalRounds).toBe(3);
    expect(summary.stats.totalToolCalls).toBe(2);
    expect(summary.stats.successfulToolCalls).toBe(1);
    expect(summary.stats.failedToolCalls).toBe(1);
    expect(summary.deductions).toHaveLength(12);
    expect(summary.deductionsByRule.D1.count).toBe(1);
    expect(summary.deductionsByRule.D11.totalPoints).toBe(AGENT_RUN_SCORE_RULE_POINTS.D11);
    expect(summary.ruleVersion).toBe('1.0');
  });

  it('never returns negative score', () => {
    const scorer = new TaskExecutionScorer();
    for (let i = 0; i < 20; i++) {
      scorer.deduct('D11', i);
    }

    const summary = scorer.summarize();
    expect(summary.score).toBe(0);
  });

  it('tracks rounds with non-incremental input', () => {
    const scorer = new TaskExecutionScorer();
    scorer.markRound(3);
    scorer.markRound(1);
    scorer.markRound(2);

    const summary = scorer.summarize();
    expect(summary.stats.totalRounds).toBe(4);
  });

  it('applies single rule deduction correctly', () => {
    const scorer = new TaskExecutionScorer();
    scorer.deduct('D12', 0);

    const summary = scorer.summarize();
    expect(summary.totalDeductions).toBe(Math.abs(AGENT_RUN_SCORE_RULE_POINTS.D12));
    expect(summary.score).toBe(100 - Math.abs(AGENT_RUN_SCORE_RULE_POINTS.D12));
    expect(summary.deductionsByRule.D12.count).toBe(1);
  });

  it('tracks lastToolWasExecuted for D3 preflight exemption', () => {
    const scorer = new TaskExecutionScorer();

    // Round 0: 工具调用但 preflight 失败（未标记 markLastToolExecuted）
    scorer.trackToolCall('tool.a');
    // 不调用 scorer.markLastToolExecuted()

    // Round 1: 同一工具重试 — 上一轮未实际执行，不应判为连续调用
    expect(scorer.lastToolId).toBe('tool.a');
    expect(scorer.lastToolWasExecuted).toBe(false);

    // Round 1: 重试后实际执行
    scorer.trackToolCall('tool.a');
    scorer.markLastToolExecuted();
    expect(scorer.lastToolWasExecuted).toBe(true);

    // Round 2: 再次调用同一工具 — 上一轮已实际执行，应判为连续调用
    expect(scorer.lastToolId).toBe('tool.a');
    expect(scorer.lastToolWasExecuted).toBe(true);

    // trackToolCall 后 lastToolExecuted 重置为 false
    scorer.trackToolCall('tool.a');
    expect(scorer.lastToolWasExecuted).toBe(false);
  });

  describe('D2/D9 deferred verdict (multi-step detection)', () => {
    it('suppresses D2/D9 when >=3 distinct tools were executed (multi-step)', () => {
      const scorer = new TaskExecutionScorer();

      // 模拟多步场景：成功执行 3 个不同工具
      scorer.trackToolCall('tool.list-agents');
      scorer.markLastToolExecuted();
      scorer.trackToolCall('tool.plan-initialize');
      scorer.markLastToolExecuted();
      scorer.trackToolCall('tool.requirement-list');
      scorer.markLastToolExecuted();

      // 产生 D2 和 D9 扣分
      scorer.deduct('D2', 0, { toolId: 'tool.plan-initialize' });
      scorer.deduct('D2', 0, { toolId: 'tool.plan-initialize' });
      scorer.deduct('D9', 5);
      // 产生非 D2/D9 扣分
      scorer.deduct('D1', 1, { toolId: 'tool.plan-initialize' });

      const summary = scorer.summarize();
      // D2/D9 全部豁免，只有 D1 生效
      expect(summary.deductions).toHaveLength(1);
      expect(summary.deductions[0].ruleId).toBe('D1');
      expect(summary.totalDeductions).toBe(Math.abs(AGENT_RUN_SCORE_RULE_POINTS.D1));
      expect(summary.deductionsByRule.D2).toBeUndefined();
      expect(summary.deductionsByRule.D9).toBeUndefined();
    });

    it('applies D2/D9 when <3 distinct tools were executed (single-step)', () => {
      const scorer = new TaskExecutionScorer();

      // 模拟单步场景：只执行了 1 个工具
      scorer.trackToolCall('tool.submit-task');
      scorer.markLastToolExecuted();

      // 产生 D2 扣分
      scorer.deduct('D2', 0, { toolId: 'tool.submit-task' });
      scorer.deduct('D9', 1);

      const summary = scorer.summarize();
      // D2/D9 全部生效
      expect(summary.deductions).toHaveLength(2);
      expect(summary.deductionsByRule.D2.count).toBe(1);
      expect(summary.deductionsByRule.D9.count).toBe(1);
    });

    it('counts only executed tools, not just tracked ones', () => {
      const scorer = new TaskExecutionScorer();

      // 3 个工具被 track 但只有 2 个真正执行
      scorer.trackToolCall('tool.a');
      scorer.markLastToolExecuted();
      scorer.trackToolCall('tool.b');
      // tool.b preflight 失败，未 markLastToolExecuted
      scorer.trackToolCall('tool.c');
      scorer.markLastToolExecuted();

      scorer.deduct('D2', 0, { toolId: 'tool.x' });

      const summary = scorer.summarize();
      // 只有 2 个 distinct executed tools < 3，D2 应生效
      expect(summary.deductions).toHaveLength(1);
      expect(summary.deductions[0].ruleId).toBe('D2');
    });
  });
});
