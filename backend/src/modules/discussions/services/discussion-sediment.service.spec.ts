import { buildOutlineDrivenSedimentMarkdown, buildSedimentMarkdown } from './discussion-sediment.service';
import {
  DiscussionMessage,
  DiscussionMessageSenderType,
  DiscussionMessageType,
} from '../../../shared/schemas/discussion-message.schema';

describe('discussion sediment markdown', () => {
  it('renders sectioned markdown with thread and knowledge blocks', () => {
    const messages: DiscussionMessage[] = [
      {
        id: 'm-1',
        spaceId: 's-1',
        threadId: 't-1',
        participantId: 'p-1',
        senderType: DiscussionMessageSenderType.USER,
        content: '先看油气价格波动原因',
        messageType: DiscussionMessageType.TEXT,
        sequence: 1,
        branchSuggestions: [],
        mentions: [],
        crossReferences: [],
        knowledgeEntryIds: [],
        dataReferences: [],
      },
    ];

    const markdown = buildSedimentMarkdown({
      sedimentTitle: '沉淀关键历史节点信息到文档',
      spaceTitle: '能源观察',
      threads: [{ id: 't-1', title: '主线', depth: 0 }],
      messages,
      knowledge: [{ title: 'IEA 数据', summary: '供需仍偏紧', credibility: 'high' }],
    });

    expect(markdown).toContain('# 沉淀关键历史节点信息到文档');
    expect(markdown).toContain('> 讨论主题：能源观察');
    expect(markdown).toContain('## 讨论线梳理');
    expect(markdown).toContain('## 知识积累');
    expect(markdown).toContain('IEA 数据');
  });

  it('renders outline driven markdown when structured outline exists', () => {
    const messages: DiscussionMessage[] = [
      {
        id: 'm-1',
        spaceId: 's-1',
        threadId: 't-1',
        participantId: 'p-1',
        senderType: DiscussionMessageSenderType.USER,
        content: 'DeFi TVL 本周上涨 12%，主要来自 L2 生态。',
        messageType: DiscussionMessageType.TEXT,
        sequence: 1,
        branchSuggestions: [],
        mentions: [],
        crossReferences: [],
        knowledgeEntryIds: [],
        dataReferences: [],
      },
    ];

    const markdown = buildOutlineDrivenSedimentMarkdown({
      sedimentTitle: 'Web3 周报沉淀',
      spaceTitle: 'Web3 行业观察',
      outlineTitle: 'Web3 行业观察大纲',
      outlineSections: [
        {
          id: 'sec-1',
          title: '关键数据指标追踪',
          order: 0,
          depth: 0,
          status: 'enriching',
          knowledgeCount: 2,
          childSectionIds: [],
          metadata: { isStructuredData: true, collectFrequency: 'daily' },
        },
      ],
      messages,
      knowledge: [
        {
          title: 'DeFiLlama TVL',
          summary: '过去 7 天 TVL 从 1330 亿美元升至 1490 亿美元。',
          credibility: 'high',
          outlineSectionId: 'sec-1',
        },
      ],
    });

    expect(markdown).toContain('## 大纲章节沉淀');
    expect(markdown).toContain('### 关键数据指标追踪');
    expect(markdown).toContain('## 数据采集建议');
    expect(markdown).toContain('DeFiLlama TVL');
  });
});
