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
});
