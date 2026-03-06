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

  it('rejects todo upsert from meeting chat source', async () => {
    const { service } = createService();
    jest.spyOn(service, 'ensureCoreDocuments').mockResolvedValue(undefined);

    await expect(
      service.upsertTaskTodo('agent-1', {
        id: 'task-1',
        title: 'Meeting note',
        sourceType: 'meeting_chat',
      }),
    ).rejects.toThrow('todo only accepts sourceType=orchestration_task');
  });

  it('routes running task to history aggregation', async () => {
    const { service } = createService();
    jest.spyOn(service, 'ensureCoreDocuments').mockResolvedValue(undefined);
    const historySpy = jest
      .spyOn(service, 'upsertTaskHistory')
      .mockResolvedValue({ id: 'history-1', memoKind: 'history' });

    const result = await service.upsertTaskTodo('agent-1', {
      id: 'task-1',
      title: 'Execute task',
      status: 'running',
      sourceType: 'orchestration_task',
    });

    expect(historySpy).toHaveBeenCalled();
    expect(result.memoKind).toBe('history');
  });

  it('archives failed task into history on completion helper', async () => {
    const { service, memoModel } = createService();
    memoModel.findOne.mockReturnValue(queryResult(null));
    const historySpy = jest
      .spyOn(service, 'upsertTaskHistory')
      .mockResolvedValue({ id: 'history-1', memoKind: 'history' });

    await service.completeTaskTodo('agent-1', 'task-1', 'runtime failed', 'failed');

    expect(historySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        taskId: 'task-1',
        status: 'failed',
      }),
    );
  });
});
