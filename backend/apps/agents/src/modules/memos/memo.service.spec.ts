import { MemoService } from './memo.service';

const queryResult = (value) => ({
  exec: jest.fn().mockResolvedValue(value),
  sort: jest.fn().mockReturnValue({
    limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }),
    skip: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }) }),
    exec: jest.fn().mockResolvedValue(value),
  }),
  limit: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }),
});

describe('MemoService', () => {
  const createService = () => {
    const memoModel = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
      deleteOne: jest.fn(),
    };
    const memoVersionModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    const memoDocSyncService = {
      syncMemo: jest.fn(),
      removeMemo: jest.fn(),
      rebuildIndex: jest.fn(),
      reportSyncError: jest.fn(),
    };
    const redisService = {
      lpush: jest.fn(),
      ltrim: jest.fn(),
      expire: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      lrange: jest.fn().mockResolvedValue([]),
      del: jest.fn(),
      llen: jest.fn().mockResolvedValue(0),
      set: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      isReady: jest.fn().mockReturnValue(true),
    };

    const service = new MemoService(memoModel, memoVersionModel, memoDocSyncService, redisService);
    memoModel.find.mockReturnValue(queryResult([]));
    memoVersionModel.findOne.mockReturnValue(queryResult(null));
    memoVersionModel.find.mockReturnValue(queryResult([]));
    return { service, memoModel };
  };

  it('returns progressive summaries for memory search', async () => {
    const { service, memoModel } = createService();
    memoModel.find.mockReturnValue(
      queryResult([
        {
          id: 'm1',
          title: 'Token usage convention',
          memoType: 'knowledge',
          memoKind: 'topic',
          payload: { topic: 'engineering' },
          tags: ['token', 'cost'],
          updatedAt: new Date(),
          content: 'Always include cost estimate before long-running operations.',
        },
      ]),
    );

    const result = await service.searchMemos('agent-1', 'token', { progressive: true, detail: false, limit: 5 });

    expect(result).toHaveLength(1);
    expect(result[0].summary).toContain('Always include cost estimate');
    expect(result[0].content).toBeUndefined();
  });

  it('updates todo status with note', async () => {
    const { service, memoModel } = createService();
    memoModel.findOne.mockReturnValue(
      queryResult({ id: 'todo-1', memoKind: 'todo', memoType: 'standard', content: 'Finish integration tests', payload: {} }),
    );
    memoModel.findOneAndUpdate.mockReturnValue(
      queryResult({
        id: 'todo-1',
        memoType: 'standard',
        memoKind: 'todo',
        payload: { status: 'completed' },
        content: 'Finish integration tests\n\n[status:completed] done',
      }),
    );

    const result = await service.updateTodoStatus('todo-1', 'completed', 'done');
    expect(result.payload?.status).toBe('completed');
    expect(result.content).toContain('[status:completed] done');
  });
});
