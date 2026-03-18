import { MeetingToolHandler } from './meeting-tool-handler.service';

describe('MeetingToolHandler generateMeetingSummary', () => {
  it('calls meeting generate-summary endpoint with default skipIfExists', async () => {
    const internalApiClient = {
      callMeetingApi: jest.fn().mockResolvedValue({
        data: {
          generated: true,
        },
      }),
    };

    const service = new MeetingToolHandler(internalApiClient as any);
    const result = await service.generateMeetingSummary({ meetingId: 'meeting-1' }, 'agent-meeting');

    expect(internalApiClient.callMeetingApi).toHaveBeenCalledWith('POST', '/meeting-1/generate-summary', {
      generatorAgentId: 'agent-meeting',
      skipIfExists: true,
    });
    expect(result.generated).toBe(true);
    expect(result.action).toBe('generate_summary');
  });

  it('throws when meetingId is missing', async () => {
    const internalApiClient = {
      callMeetingApi: jest.fn(),
    };

    const service = new MeetingToolHandler(internalApiClient as any);
    await expect(service.generateMeetingSummary({}, 'agent-meeting')).rejects.toThrow(
      'meeting_generate_summary requires meetingId',
    );
  });
});
