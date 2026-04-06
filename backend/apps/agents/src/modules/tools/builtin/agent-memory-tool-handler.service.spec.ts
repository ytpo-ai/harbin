import { MemoToolHandler } from './agent-memory-tool-handler.service';

describe('MemoToolHandler', () => {
  it('requires agentId for search', async () => {
    const handler = new MemoToolHandler({ searchMemos: jest.fn() } as any, {} as any);

    await expect(handler.searchMemoMemory({ query: 'x' })).rejects.toThrow('memo_mcp_search requires agentId');
  });

  it('requires content for append', async () => {
    const handler = new MemoToolHandler({} as any, {} as any);

    await expect(handler.appendMemoMemory({}, 'agent-1')).rejects.toThrow('memo_mcp_append requires content');
  });
});
