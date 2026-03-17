import { AgentOrchestrationIntentService } from './agent-orchestration-intent.service';

describe('AgentOrchestrationIntentService short confirm intent', () => {
  it('treats "确认" as run-plan confirmation when planId is recoverable', () => {
    const service = new AgentOrchestrationIntentService();
    const task: any = {
      title: '会议任务',
      description: '执行会议计划',
      type: 'meeting',
      messages: [
        {
          role: 'assistant',
          content: '已触发计划创建，planId=abc123def456。',
          timestamp: new Date(),
        },
        {
          role: 'user',
          content: '确认',
          timestamp: new Date(),
        },
      ],
    };

    const action = service.extractForcedOrchestrationAction(
      task,
      [],
      new Set(['builtin.sys-mg.mcp.orchestration.run-plan']),
      {
        taskType: 'meeting',
        teamContext: {
          meetingId: 'meeting-1',
        },
      },
    );

    expect(action?.tool).toBe('builtin.sys-mg.mcp.orchestration.run-plan');
    expect(action?.parameters?.planId).toBe('abc123def456');
  });
});
