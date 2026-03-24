import { MeetingToolHandler } from './meeting-tool-handler.service';

describe('MeetingToolHandler', () => {
  it('strips messages from listMeetings output', async () => {
    const internalApiClient = {
      callMeetingApi: jest.fn().mockResolvedValue([
        { id: 'meeting-1', title: 'Demo', messages: [{ id: 'm1', content: 'hello' }], messageCount: 1 },
      ]),
    };

    const service = new MeetingToolHandler(internalApiClient as any);
    const result = await service.listMeetings({});

    expect(result.total).toBe(1);
    expect(result.meetings[0].messages).toBeUndefined();
    expect(result.meetings[0].id).toBe('meeting-1');
  });

  it('gets meeting detail by id', async () => {
    const internalApiClient = {
      callMeetingApi: jest.fn().mockResolvedValue({
        data: { id: 'meeting-1', messages: [{ id: 'm1' }] },
      }),
    };

    const service = new MeetingToolHandler(internalApiClient as any);
    const result = await service.getMeetingDetail({ meetingId: 'meeting-1' });

    expect(internalApiClient.callMeetingApi).toHaveBeenCalledWith('GET', '/meeting-1/detail');
    expect(result.action).toBe('get_detail');
    expect(result.meeting.id).toBe('meeting-1');
  });

  it('saves summary via summary endpoint', async () => {
    const internalApiClient = {
      callMeetingApi: jest.fn().mockResolvedValue({
        data: {
          generated: true,
        },
      }),
    };

    const service = new MeetingToolHandler(internalApiClient as any);
    const result = await service.saveMeetingSummary(
      {
        meetingId: 'meeting-1',
        summary: 'summary text',
        actionItems: ['todo-1'],
        decisions: ['decision-1'],
      },
      'agent-meeting',
    );

    expect(internalApiClient.callMeetingApi).toHaveBeenCalledWith('PUT', '/meeting-1/summary', {
      summary: 'summary text',
      actionItems: ['todo-1'],
      decisions: ['decision-1'],
      overwrite: false,
      generatedByAgentId: 'agent-meeting',
    });
    expect(result.generated).toBe(true);
    expect(result.action).toBe('save_summary');
  });

  it('throws when meetingId is missing', async () => {
    const internalApiClient = {
      callMeetingApi: jest.fn(),
    };

    const service = new MeetingToolHandler(internalApiClient as any);
    await expect(service.saveMeetingSummary({ summary: 'x' }, 'agent-meeting')).rejects.toThrow(
      'meeting_save_summary requires meetingId',
    );
  });

  it('throws when summary is missing', async () => {
    const internalApiClient = {
      callMeetingApi: jest.fn(),
    };

    const service = new MeetingToolHandler(internalApiClient as any);
    await expect(service.saveMeetingSummary({ meetingId: 'meeting-1' }, 'agent-meeting')).rejects.toThrow(
      'meeting_save_summary requires summary',
    );
  });
});
