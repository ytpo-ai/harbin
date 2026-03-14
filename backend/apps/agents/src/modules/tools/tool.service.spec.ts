import { ToolService } from './tool.service';
import { RepoToolHandler } from './repo-tool-handler.service';
import axios from 'axios';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

describe('ToolService orchestration debug task', () => {
  const buildService = () => {
    const service = Object.create(ToolService.prototype);
    service.assertExecutionContext = jest.fn().mockReturnValue({ mode: 'meeting', meetingId: 'meeting-1' });
    service.internalApiClient = {
      callOrchestrationApi: jest.fn(),
    };
    return service;
  };

  it('throws when taskId is missing', async () => {
    const service = buildService();
    await expect(service['debugOrchestrationTask']({}, 'agent-1', {})).rejects.toThrow(
      'orchestration_debug_task requires taskId',
    );
  });

  it('calls debug-run endpoint and returns debug summary', async () => {
    const service = buildService();
    service.internalApiClient.callOrchestrationApi.mockResolvedValue({
      task: {
        status: 'failed',
        runLogs: [{ message: 'log-1' }, { message: 'log-2' }],
      },
      execution: {
        status: 'failed',
        error: 'boom',
        result: 'stack',
      },
    });

    const result = await service['debugOrchestrationTask'](
      {
        taskId: 'task-1',
        title: ' Debug title ',
        description: ' Debug description ',
        resetResult: true,
      },
      'agent-1',
      {},
    );

    expect(service.internalApiClient.callOrchestrationApi).toHaveBeenCalledWith('POST', '/tasks/task-1/debug-run', {
      title: 'Debug title',
      description: 'Debug description',
      resetResult: true,
    });
    expect(result.action).toBe('debug_task');
    expect(result.debug.status).toBe('failed');
    expect(result.debug.error).toBe('boom');
    expect(result.debug.suggestedNextAction).toContain('retry debug');
  });

  it('returns completed next action hint', async () => {
    const service = buildService();
    service.internalApiClient.callOrchestrationApi.mockResolvedValue({
      task: { status: 'completed', runLogs: [] },
      execution: { status: 'completed', result: 'ok' },
    });

    const result = await service['debugOrchestrationTask']({ taskId: 'task-2' }, 'agent-2', {});
    expect(result.debug.status).toBe('completed');
    expect(result.debug.suggestedNextAction).toContain('downstream');
  });
});

describe('ToolService skill master mcp', () => {
  it('maps title fuzzy query to skills search', async () => {
    const service = Object.create(ToolService.prototype);
    service.skillToolHandler = {
      listSkillsByTitle: jest.fn().mockResolvedValue({
        total: 1,
        page: 1,
        pageSize: 5,
        totalPages: 1,
        items: [
          {
            id: 'skill-1',
            title: 'TypeScript Expert',
            name: 'TypeScript Expert',
            description: 'TypeScript engineering skill',
            category: 'engineering',
            status: 'active',
            tags: ['typescript'],
            provider: 'system',
            version: '1.0.0',
            confidenceScore: 80,
            updatedAt: '2026-03-10T00:00:00.000Z',
          },
        ],
      }),
    };

    const result = await service['listSkillsByTitle']({ title: 'script', limit: 5, page: 1 });

    expect(service.skillToolHandler.listSkillsByTitle).toHaveBeenCalledWith({ title: 'script', limit: 5, page: 1 });
    expect(result.items[0].title).toBe('TypeScript Expert');
  });

  it('creates skill with title field', async () => {
    const service = Object.create(ToolService.prototype);
    service.skillToolHandler = {
      createSkillByMcp: jest.fn().mockResolvedValue({
        created: true,
        skill: {
          id: 'skill-2',
          title: 'Prompt Design',
        },
      }),
    };

    const result = await service['createSkillByMcp']({
      title: 'Prompt Design',
      description: 'Prompt design and optimization',
      tags: ['prompt', '  '],
    });

    expect(service.skillToolHandler.createSkillByMcp).toHaveBeenCalledWith({
      title: 'Prompt Design',
      description: 'Prompt design and optimization',
      tags: ['prompt', '  '],
    });
    expect(result.created).toBe(true);
    expect(result.skill.title).toBe('Prompt Design');
  });

  it('throws when create skill missing description', async () => {
    const service = Object.create(ToolService.prototype);
    service.skillToolHandler = {
      createSkillByMcp: jest.fn().mockRejectedValue(new Error('skill_master_create_skill requires description')),
    };

    await expect(service['createSkillByMcp']({ title: 'No Desc' })).rejects.toThrow(
      'skill_master_create_skill requires description',
    );
  });
});

describe('ToolService getToolRegistry prompt field', () => {
  it('includes prompt in registry item when tool has prompt', async () => {
    const service = Object.create(ToolService.prototype);
    service.getAllTools = jest.fn().mockResolvedValue([
      {
        id: 'memo_mcp_append',
        canonicalId: 'builtin.sys-mg.internal.memory.append-memo',
        name: 'Memo MCP Append',
        description: 'Append memo entry',
        prompt: '请将输入追加到目标 agent 的 memo。',
        category: 'memory',
        enabled: true,
        type: 'custom',
        requiredPermissions: [],
        capabilitySet: [],
        tokenCost: 0,
      },
    ]);
    service.parseToolIdentity = jest.fn().mockReturnValue({
      provider: 'builtin',
      executionChannel: 'sys-mg',
      toolkitId: 'memory',
      namespace: 'sys-mg',
      resource: 'memory',
      action: 'append-memo',
    });
    service.normalizeBooleanQuery = jest.fn().mockReturnValue(undefined);

    const result = await service.getToolRegistry({});

    expect(result).toHaveLength(1);
    expect(result[0].toolId).toBe('builtin.sys-mg.internal.memory.append-memo');
    expect(result[0].prompt).toBe('请将输入追加到目标 agent 的 memo。');
  });
});

describe('ToolService agent master create agent mcp', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates agent with role code and provider default api-key fallback', async () => {
    const service = Object.create(ToolService.prototype);
    service.modelManagementService = {
      getModelById: jest.fn().mockResolvedValue({
        id: 'openai-gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        model: 'gpt-4o-mini',
        maxTokens: 8192,
        temperature: 0.2,
      }),
    };
    service.apiKeyModel = {
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ id: 'default-openai-key' }),
          }),
        }),
      }),
    };
    service.backendBaseUrl = 'http://localhost:3001/api';
    service.internalApiClient = {
      buildSignedHeaders: jest.fn().mockReturnValue({}),
      callAgentsApi: jest.fn().mockResolvedValue({
        id: 'agent-001',
        name: 'Nina',
        roleId: '71e69181-bcb1-4355-8dc4-691f29ea49ad',
        isActive: true,
      }),
    };

    const getSpy = jest
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(new Error('role id not found'))
      .mockResolvedValueOnce({
        data: [{ id: '71e69181-bcb1-4355-8dc4-691f29ea49ad', code: 'role-zero-hours-worker', name: '临时工' }],
      } as any);

    const result = await service['createAgentByMcp']({
      name: 'Nina',
      roleId: 'role-zero-hours-worker',
      modelId: 'openai-gpt-4o-mini',
    });

    expect(getSpy).toHaveBeenCalledTimes(2);

    expect(service.apiKeyModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', isDefault: true, isActive: true }),
    );
    expect(service.internalApiClient.callAgentsApi).toHaveBeenCalledWith(
      'POST',
      '/agents',
      expect.objectContaining({
        name: 'Nina',
        roleId: '71e69181-bcb1-4355-8dc4-691f29ea49ad',
        apiKeyId: 'default-openai-key',
        model: expect.objectContaining({ provider: 'openai' }),
      }),
    );
    expect(result.created).toBe(true);
    expect(result.apiKeySource).toBe('provider-default');
    expect(result.roleResolvedBy).toBe('code');
  });

  it('throws when name is missing', async () => {
    const service = Object.create(ToolService.prototype);
    await expect(service['createAgentByMcp']({ roleId: 'role-1', modelId: 'm1' })).rejects.toThrow(
      'agent_master_create_agent requires name',
    );
  });
});

describe('ToolService rd-related docs-write mcp', () => {
  it('creates markdown file under docs path', async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'tool-service-docs-write-'));
    const service = Object.create(ToolService.prototype);
    const repoToolHandler = Object.create(RepoToolHandler.prototype);
    repoToolHandler.resolveWorkspaceRoot = jest.fn().mockResolvedValue(tmpRoot);
    service.repoToolHandler = repoToolHandler;

    const result = await service['executeDocsWrite']({
      filePath: 'docs/plan/test-doc.md',
      content: '# test\n',
      mode: 'create',
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toBe('docs/plan/test-doc.md');
    expect(result.mode).toBe('create');

    const content = await readFile(path.join(tmpRoot, 'docs/plan/test-doc.md'), 'utf8');
    expect(content).toBe('# test\n');

    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('rejects non-docs path', async () => {
    const service = Object.create(ToolService.prototype);
    const repoToolHandler = Object.create(RepoToolHandler.prototype);
    repoToolHandler.resolveWorkspaceRoot = jest.fn().mockResolvedValue('/tmp/workspace');
    service.repoToolHandler = repoToolHandler;

    await expect(
      service['executeDocsWrite']({
        filePath: 'backend/notes.md',
        content: 'x',
        mode: 'create',
      }),
    ).rejects.toThrow('docs_write only supports docs/** paths');
  });

  it('rejects non-markdown extension', async () => {
    const service = Object.create(ToolService.prototype);
    const repoToolHandler = Object.create(RepoToolHandler.prototype);
    repoToolHandler.resolveWorkspaceRoot = jest.fn().mockResolvedValue('/tmp/workspace');
    service.repoToolHandler = repoToolHandler;

    await expect(
      service['executeDocsWrite']({
        filePath: 'docs/plan/test-doc.txt',
        content: 'x',
        mode: 'create',
      }),
    ).rejects.toThrow('docs_write only supports .md files');
  });

  it('rejects create conflict when file exists and overwrite is false', async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'tool-service-docs-write-'));
    const target = path.join(tmpRoot, 'docs/plan/conflict.md');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'old', 'utf8');

    const service = Object.create(ToolService.prototype);
    const repoToolHandler = Object.create(RepoToolHandler.prototype);
    repoToolHandler.resolveWorkspaceRoot = jest.fn().mockResolvedValue(tmpRoot);
    service.repoToolHandler = repoToolHandler;

    await expect(
      service['executeDocsWrite']({
        filePath: 'docs/plan/conflict.md',
        content: 'new',
        mode: 'create',
      }),
    ).rejects.toThrow('docs_write create mode conflict: file exists, set overwrite=true to replace it');

    await rm(tmpRoot, { recursive: true, force: true });
  });
});
