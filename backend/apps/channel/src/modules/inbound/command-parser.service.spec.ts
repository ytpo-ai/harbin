import { CommandParserService } from './command-parser.service';

describe('CommandParserService', () => {
  const service = new CommandParserService();

  it('parses plain text as chat', () => {
    const parsed = service.parse('hello world');
    expect(parsed.type).toBe('chat');
    expect(parsed.args.prompt).toBe('hello world');
  });

  it('parses /plan new command', () => {
    const parsed = service.parse('/plan new 实现日报自动汇总');
    expect(parsed.type).toBe('plan_new');
    expect(parsed.args.prompt).toBe('实现日报自动汇总');
  });

  it('parses /plan status command', () => {
    const parsed = service.parse('/plan status plan-123');
    expect(parsed.type).toBe('plan_status');
    expect(parsed.args.planId).toBe('plan-123');
  });

  it('parses /plan cancel command', () => {
    const parsed = service.parse('/plan cancel run-123');
    expect(parsed.type).toBe('plan_cancel');
    expect(parsed.args.id).toBe('run-123');
  });

  it('parses /agent chat command', () => {
    const parsed = service.parse('/agent chat agent-1 hi there');
    expect(parsed.type).toBe('agent_chat');
    expect(parsed.args.agentId).toBe('agent-1');
    expect(parsed.args.prompt).toBe('hi there');
  });

  it('parses /session reset command', () => {
    const parsed = service.parse('/session reset');
    expect(parsed.type).toBe('session_reset');
  });

  it('parses /meeting commands', () => {
    expect(service.parse('/meeting list').type).toBe('meeting_list');
    expect(service.parse('/meeting leave').type).toBe('meeting_leave');
    expect(service.parse('/meeting end').type).toBe('meeting_end');
    const create = service.parse('/meeting create 研发评审会');
    expect(create.type).toBe('meeting_create');
    expect(create.args.title).toBe('研发评审会');
    const join = service.parse('/meeting join mtg-123');
    expect(join.type).toBe('meeting_join');
    expect(join.args.meetingId).toBe('mtg-123');
  });

  it('parses unknown command as unknown_command', () => {
    const parsed = service.parse('/plan');
    expect(parsed.type).toBe('unknown_command');
  });

  it('parses bind token command', () => {
    const parsed = service.parse('/bind token:abc123');
    expect(parsed.type).toBe('bind');
    expect(parsed.args.token).toBe('abc123');
    expect(parsed.args.email).toBeUndefined();
  });

  it('parses bind token command with trailing words', () => {
    const parsed = service.parse('/bind token:abc123 van');
    expect(parsed.type).toBe('bind');
    expect(parsed.args.token).toBe('abc123');
  });

  it('parses bind email command as fallback', () => {
    const parsed = service.parse('/bind user@example.com');
    expect(parsed.type).toBe('bind');
    expect(parsed.args.email).toBe('user@example.com');
    expect(parsed.args.token).toBeUndefined();
  });
});
