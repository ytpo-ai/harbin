import { buildSystemContextKey } from './context-fingerprint.util';

describe('buildSystemContextKey', () => {
  it('builds keys for expanded context families', () => {
    expect(buildSystemContextKey('协作上下文(会议): {"meetingId":"m-1"}')).toMatch(/^collab:/);
    expect(buildSystemContextKey('你正在参加一个会议，会议标题是"周会"。')).toBe('meeting_brief:周会');
    expect(buildSystemContextKey('【身份与职责】以下是你的身份定义')).toMatch(/^identity_memo:/);
    expect(buildSystemContextKey('业务领域上下文:\n- domainType: engineering')).toMatch(/^domain:/);
    expect(buildSystemContextKey('任务信息:\n标题: A')).toMatch(/^task_info:/);
    expect(buildSystemContextKey('任务信息增量更新：\n- 标题：A -> B')).toMatch(/^task_info:/);
    expect(buildSystemContextKey('当你需要调用工具时，请先判断权限')).toMatch(/^tool_injection:/);
    expect(buildSystemContextKey('工具使用策略（builtin.demo）:\nxxx')).toMatch(/^tool_strategy:/);
    expect(buildSystemContextKey('Enabled Skills for this agent:\n- x')).toMatch(/^skill_index:/);
    expect(buildSystemContextKey('工作记忆（历史运行摘要）:\n- r1')).toMatch(/^run_summaries:/);
    expect(buildSystemContextKey('从备忘录中按需检索到的相关记忆：\n- item')).toMatch(/^memo_recall:/);
  });
});
