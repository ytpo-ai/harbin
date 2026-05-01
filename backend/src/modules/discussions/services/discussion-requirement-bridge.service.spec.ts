import axios from 'axios';
import { DiscussionRequirementBridgeService } from './discussion-requirement-bridge.service';

jest.mock('axios', () => ({
  post: jest.fn(),
}));

jest.mock('@libs/auth', () => ({
  encodeUserContext: jest.fn(() => 'encoded-context'),
  signEncodedContext: jest.fn(() => 'signed-context'),
}));

jest.mock('../../../shared/common/utils/unwrap-response-envelope', () => ({
  unwrapResponseEnvelope: jest.fn((input: any) => input),
}));

const axiosPost = (axios as any).post as jest.Mock;

describe('DiscussionRequirementBridgeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ENGINEERING_INTELLIGENCE_SERVICE_URL;
    delete process.env.ENGINEERING_INTELLIGENCE_CLIENT_TIMEOUT_MS;
    delete process.env.INTERNAL_CONTEXT_SECRET;
  });

  it('posts requirement payload with discussion source and signed headers', async () => {
    process.env.ENGINEERING_INTELLIGENCE_SERVICE_URL = 'http://ei-service:3004';
    process.env.ENGINEERING_INTELLIGENCE_CLIENT_TIMEOUT_MS = '15000';
    axiosPost.mockResolvedValue({
      data: {
        requirementId: 'REQ-1001',
        title: '自动创建需求',
      },
    });

    const service = new DiscussionRequirementBridgeService();

    const result = await service.createRequirementFromDiscussion({
      title: ' 自动创建需求 ',
      description: ' 将讨论结论转为需求 ',
      priority: 'high',
      projectId: '  project-1 ',
      createdById: '  user-1 ',
      createdByName: '  Van ',
      source: {
        spaceId: 'space-1',
        spaceTitle: '行业观察',
        threadId: 'thread-1',
        threadTitle: '宏观趋势',
        messageId: 'msg-1',
        messagePreview: '需要每周采集交易量数据',
      },
    });

    expect(axiosPost).toHaveBeenCalledWith(
      'http://ei-service:3004/api/ei/requirements',
      expect.objectContaining({
        title: '自动创建需求',
        description: '将讨论结论转为需求',
        priority: 'high',
        category: 'feature',
        complexity: 'low',
        createdById: 'user-1',
        createdByName: 'Van',
        createdByType: 'human',
        projectId: 'project-1',
        localProjectId: 'project-1',
        discussionSource: {
          spaceId: 'space-1',
          spaceTitle: '行业观察',
          threadId: 'thread-1',
          threadTitle: '宏观趋势',
          messageId: 'msg-1',
          messagePreview: '需要每周采集交易量数据',
        },
      }),
      expect.objectContaining({
        timeout: 15000,
        headers: expect.objectContaining({
          'x-user-context': 'encoded-context',
          'x-user-signature': 'signed-context',
          'content-type': 'application/json',
        }),
      }),
    );
    expect(result).toEqual({
      requirementId: 'REQ-1001',
      title: '自动创建需求',
    });
  });

  it('falls back to payload title when response title is empty', async () => {
    axiosPost.mockResolvedValue({
      data: {
        requirementId: 'REQ-1002',
        title: '',
      },
    });

    const service = new DiscussionRequirementBridgeService();
    const result = await service.createRequirementFromDiscussion({
      title: '讨论行动项',
      source: {
        spaceId: 'space-1',
        spaceTitle: '行业观察',
        threadId: 'thread-1',
        threadTitle: '宏观趋势',
        messageId: 'msg-1',
        messagePreview: 'message',
      },
    });

    expect(result).toEqual({
      requirementId: 'REQ-1002',
      title: '讨论行动项',
    });
  });
});
