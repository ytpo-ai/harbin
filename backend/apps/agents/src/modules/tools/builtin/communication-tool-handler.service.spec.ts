import { CommunicationToolHandler } from './communication-tool-handler.service';

describe('CommunicationToolHandler', () => {
  it('requires channel and text for slack send', async () => {
    const handler = new CommunicationToolHandler({ executeToolById: jest.fn() } as any, {} as any);

    await expect(handler.sendSlackMessage({ channel: '', text: '' })).rejects.toThrow(
      'slack requires parameters: channel, text',
    );
  });

  it('requires execution agent for internal message', async () => {
    const handler = new CommunicationToolHandler({} as any, {} as any);

    await expect(
      handler.sendInternalMessage({ receiverAgentId: 'agent-2', title: 'a', content: 'b' }, undefined),
    ).rejects.toThrow('send_internal_message requires execution agentId');
  });
});
