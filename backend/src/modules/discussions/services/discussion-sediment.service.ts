import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DiscussionMessage,
  DiscussionMessageDocument,
  DiscussionMessageSenderType,
} from '../../../shared/schemas/discussion-message.schema';
import {
  DiscussionSedimentMode,
  DiscussionSpace,
  DiscussionSpaceDocument,
} from '../../../shared/schemas/discussion-space.schema';
import { DiscussionThread, DiscussionThreadDocument } from '../../../shared/schemas/discussion-thread.schema';
import { DiscussionKnowledgeService } from './discussion-knowledge.service';

export interface GeneratedSedimentResult {
  mode: DiscussionSedimentMode;
  version: number;
  content: string;
  threadScope: string[];
  createdAt: string;
}

export function buildSedimentMarkdown(input: {
  spaceTitle: string;
  threads: Array<{ id: string; title: string; depth: number }>;
  messages: DiscussionMessage[];
  knowledge: Array<{ title: string; summary: string; credibility: string }>;
}): string {
  const lines: string[] = [];
  lines.push(`# ${input.spaceTitle}`);
  lines.push('');
  lines.push('## 讨论沉淀摘要');

  const latestMessages = input.messages.slice(-3).map((message) => message.content.trim()).filter(Boolean);
  if (latestMessages.length) {
    lines.push(`最近讨论聚焦于：${latestMessages.join('；')}`);
  } else {
    lines.push('当前暂无有效讨论内容。');
  }

  lines.push('');
  lines.push('## 讨论线梳理');

  for (const thread of input.threads) {
    lines.push(`### ${'  '.repeat(Math.max(0, thread.depth))}${thread.title}`);
    const threadMessages = input.messages
      .filter((message) => message.threadId === thread.id)
      .slice(-5)
      .map((message) => {
        const sender =
          message.senderType === DiscussionMessageSenderType.AI
            ? 'AI'
            : message.senderType === DiscussionMessageSenderType.SYSTEM
              ? '系统'
              : '用户';
        return `- [${sender}] ${message.content.replace(/\s+/g, ' ').trim()}`;
      });

    if (!threadMessages.length) {
      lines.push('- 暂无消息');
    } else {
      lines.push(...threadMessages);
    }
    lines.push('');
  }

  lines.push('## 知识积累');
  if (!input.knowledge.length) {
    lines.push('- 暂无知识条目');
  } else {
    for (const item of input.knowledge.slice(0, 10)) {
      lines.push(`- ${item.title}（可信度：${item.credibility}）: ${item.summary}`);
    }
  }

  return lines.join('\n').trim();
}

@Injectable()
export class DiscussionSedimentService {
  constructor(
    @InjectModel(DiscussionSpace.name)
    private readonly discussionSpaceModel: Model<DiscussionSpaceDocument>,
    @InjectModel(DiscussionThread.name)
    private readonly discussionThreadModel: Model<DiscussionThreadDocument>,
    @InjectModel(DiscussionMessage.name)
    private readonly discussionMessageModel: Model<DiscussionMessageDocument>,
    private readonly discussionKnowledgeService: DiscussionKnowledgeService,
  ) {}

  async updateSedimentMode(spaceId: string, mode: DiscussionSedimentMode): Promise<DiscussionSpace> {
    const updated = await this.discussionSpaceModel
      .findOneAndUpdate({ id: spaceId }, { $set: { sedimentMode: mode } }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }

    return updated as unknown as DiscussionSpace;
  }

  async generateSediment(input: {
    spaceId: string;
    mode?: DiscussionSedimentMode;
    threadScope?: string[];
  }): Promise<GeneratedSedimentResult> {
    const space = await this.discussionSpaceModel.findOne({ id: input.spaceId }).lean().exec();
    if (!space) {
      throw new NotFoundException(`讨论空间不存在: ${input.spaceId}`);
    }

    const threadFilter: Record<string, any> = { spaceId: input.spaceId };
    if (input.threadScope?.length) {
      threadFilter.id = { $in: input.threadScope };
    }

    const threads = (await this.discussionThreadModel
      .find(threadFilter)
      .sort({ depth: 1, createdAt: 1 })
      .lean()
      .exec()) as unknown as DiscussionThread[];

    const threadIds = threads.map((thread) => thread.id);
    const messages = (await this.discussionMessageModel
      .find({ spaceId: input.spaceId, ...(threadIds.length ? { threadId: { $in: threadIds } } : {}) })
      .sort({ createdAt: 1 })
      .lean()
      .exec()) as unknown as DiscussionMessage[];

    const knowledgeEntries = await this.discussionKnowledgeService.listKnowledgeEntries(input.spaceId, {
      limit: 20,
    });

    const content = buildSedimentMarkdown({
      spaceTitle: space.title,
      threads: threads.map((thread) => ({ id: thread.id, title: thread.title, depth: thread.depth })),
      messages,
      knowledge: knowledgeEntries.map((item) => ({
        title: item.title,
        summary: item.summary,
        credibility: item.credibility,
      })),
    });

    const nextVersion = Number(space.sedimentHistory?.length || 0) + 1;
    const createdAt = new Date();
    const mode = input.mode || space.sedimentMode || DiscussionSedimentMode.MANUAL;

    await this.discussionSpaceModel
      .updateOne(
        { id: input.spaceId },
        {
          $set: {
            sedimentMode: mode,
            latestSedimentedDocument: content,
            documentOutline: {
              title: space.title,
              sections: ['讨论沉淀摘要', '讨论线梳理', '知识积累'],
              updatedAt: createdAt,
            },
          },
          $push: {
            sedimentHistory: {
              version: nextVersion,
              content,
              threadScope: threadIds,
              createdAt,
            },
          },
        },
      )
      .exec();

    return {
      mode,
      version: nextVersion,
      content,
      threadScope: threadIds,
      createdAt: createdAt.toISOString(),
    };
  }

  async getLatestSediment(spaceId: string): Promise<GeneratedSedimentResult | null> {
    const space = await this.discussionSpaceModel.findOne({ id: spaceId }).lean().exec();
    if (!space || !space.latestSedimentedDocument) {
      return null;
    }

    const history = Array.isArray(space.sedimentHistory) ? space.sedimentHistory : [];
    const latest = history[history.length - 1];

    return {
      mode: space.sedimentMode || DiscussionSedimentMode.MANUAL,
      version: latest?.version || history.length || 1,
      content: space.latestSedimentedDocument,
      threadScope: latest?.threadScope || [],
      createdAt: latest?.createdAt ? new Date(latest.createdAt).toISOString() : new Date().toISOString(),
    };
  }
}
