import { MemoService } from './memo.service';

const queryResult = <T>(value: T) => ({
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
    const memoDocSyncService = {
      syncMemo: jest.fn(),
      removeMemo: jest.fn(),
      rebuildIndex: jest.fn(),
      reportSyncError: jest.fn(),
    };

    const service = new MemoService(memoModel as any, memoDocSyncService as any);
    return { service, memoModel };
  };

  it('returns progressive summaries for memory search', async () => {
    const { service, memoModel } = createService();
    memoModel.find.mockReturnValue(
      queryResult([
        {
          id: 'm1',
          title: 'Token usage convention',
          category: 'engineering',
          memoType: 'knowledge',
          todoStatus: undefined,
          tags: ['token', 'cost'],
          updatedAt: new Date(),
          content: 'Always include cost estimate before long-running operations.',
        },
      ]),
    );
    memoModel.findOneAndUpdate.mockReturnValue(queryResult(null));

    const result = await service.searchMemos('agent-1', 'token', { progressive: true, detail: false, limit: 5 });

    expect(result).toHaveLength(1);
    expect(result[0].summary).toContain('Always include cost estimate');
    expect(result[0].content).toBeUndefined();
  });

  it('updates todo status with note', async () => {
    const { service, memoModel } = createService();
    memoModel.findOne.mockReturnValue(
      queryResult({ id: 'todo-1', memoType: 'todo', content: 'Finish integration tests' }),
    );
    memoModel.findOneAndUpdate.mockReturnValue(
      queryResult({
        id: 'todo-1',
        memoType: 'todo',
        todoStatus: 'completed',
        content: 'Finish integration tests\n\n[status:completed] done',
      }),
    );

    const result = await service.updateTodoStatus('todo-1', 'completed', 'done');
    expect(result.todoStatus).toBe('completed');
    expect(result.content).toContain('[status:completed] done');
  });
});
