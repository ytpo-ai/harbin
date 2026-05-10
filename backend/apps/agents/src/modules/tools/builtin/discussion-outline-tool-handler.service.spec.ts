import { DiscussionOutlineToolHandler } from './discussion-outline-tool-handler.service';

describe('DiscussionOutlineToolHandler', () => {
  it('returns outline with unified envelope', async () => {
    const internalApiClient = {
      callDiscussionApi: jest
        .fn()
        .mockResolvedValueOnce({ id: 'space-1', projectId: 'proj-1' })
        .mockResolvedValueOnce({ title: 'outline-title', sections: [] }),
    };

    const service = new DiscussionOutlineToolHandler(internalApiClient as any);
    const result = await service.manage(
      {
        action: 'get_outline',
        spaceId: 'space-1',
        projectId: 'proj-1',
      },
      'agent-owner',
    );

    expect(result.ok).toBe(true);
    expect(result.action).toBe('get_outline');
    expect(result.projectId).toBe('proj-1');
    expect(internalApiClient.callDiscussionApi).toHaveBeenNthCalledWith(1, 'GET', '/space-1');
    expect(internalApiClient.callDiscussionApi).toHaveBeenNthCalledWith(2, 'GET', '/space-1/outline');
  });

  it('rejects cross-project space access', async () => {
    const internalApiClient = {
      callDiscussionApi: jest.fn().mockResolvedValue({ id: 'space-1', projectId: 'proj-actual' }),
    };

    const service = new DiscussionOutlineToolHandler(internalApiClient as any);
    const result = await service.manage({ action: 'get_outline', spaceId: 'space-1', projectId: 'proj-expected' }, 'agent-1');

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('discussion_outline_project_mismatch');
  });

  it('accepts enrich fallback when fallbackReason is provided', async () => {
    const internalApiClient = {
      callDiscussionApi: jest
        .fn()
        .mockResolvedValueOnce({ id: 'space-1', projectId: 'proj-1' })
        .mockResolvedValueOnce({
          sectionId: 'sec-1',
          enrichedCount: 0,
          enrichmentMeta: { mode: 'fallback', fallbackReason: 'agent_response_non_json' },
        })
        .mockResolvedValueOnce([]),
    };

    const service = new DiscussionOutlineToolHandler(internalApiClient as any);
    const result = await service.manage({ action: 'enrich_section', spaceId: 'space-1', sectionId: 'sec-1' }, 'agent-1');

    expect(result.ok).toBe(true);
    expect(result.data.fallbackReason).toBe('agent_response_non_json');
    expect(Array.isArray(result.data.acceptedEntries)).toBe(true);
    expect(result.data.acceptedEntries).toHaveLength(0);
  });

  it('rejects enrich result without structured entries and fallbackReason', async () => {
    const internalApiClient = {
      callDiscussionApi: jest
        .fn()
        .mockResolvedValueOnce({ id: 'space-1', projectId: 'proj-1' })
        .mockResolvedValueOnce({
          sectionId: 'sec-1',
          enrichedCount: 0,
          enrichmentMeta: { mode: 'agent', acceptedAgentEntries: 0, createdFallbackEntries: 0 },
        })
        .mockResolvedValueOnce([]),
    };

    const service = new DiscussionOutlineToolHandler(internalApiClient as any);
    const result = await service.manage({ action: 'enrich_section', spaceId: 'space-1', sectionId: 'sec-1' }, 'agent-1');

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('discussion_outline_enrich_result_rejected');
  });
});
