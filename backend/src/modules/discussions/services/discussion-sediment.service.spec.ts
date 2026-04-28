import { buildSedimentMarkdown } from './discussion-sediment.service';
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
      },
    ];

    const markdown = buildSedimentMarkdown({
      spaceTitle: '能源观察',
      threads: [{ id: 't-1', title: '主线', depth: 0 }],
      messages,
      knowledge: [{ title: 'IEA 数据', summary: '供需仍偏紧', credibility: 'high' }],
    });

    expect(markdown).toContain('# 能源观察');
    expect(markdown).toContain('## 讨论线梳理');
    expect(markdown).toContain('## 知识积累');
    expect(markdown).toContain('IEA 数据');
  });
});
