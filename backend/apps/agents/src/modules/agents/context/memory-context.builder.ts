import { Injectable } from '@nestjs/common';
import { MemoService } from '@agent/modules/memos/memo.service';
import { ChatMessage } from '../../../../../../src/shared/types';
import { ContextBlockBuilder, ContextBuildInput } from './context-block-builder.interface';

@Injectable()
export class MemoryContextBuilder implements ContextBlockBuilder {
  readonly layer = 'memory' as const;
  readonly meta = { scope: 'run', stability: 'dynamic' } as const;

  constructor(private readonly memoService: MemoService) {}

  shouldInject(input: ContextBuildInput): boolean {
    return Boolean(input.persistedContext?.runSummaries?.length || input.agent.id);
  }

  async build(input: ContextBuildInput): Promise<ChatMessage[]> {
    const summaries = input.persistedContext?.runSummaries || [];
    const messages: ChatMessage[] = [];

    if (summaries.length) {
      const lines = summaries.slice(-8).map((summary, index) => {
        const title = summary.taskTitle || summary.taskId || `run-${index + 1}`;
        const outcome = summary.outcome || '';
        const outputs = (summary.keyOutputs || []).join('；');
        return `- ${title}: ${outcome}${outputs ? ` | outputs: ${outputs}` : ''}`;
      });
      messages.push({
        role: 'system',
        content: `工作记忆（历史运行摘要）:\n${lines.join('\n')}`,
        timestamp: new Date(),
      });
    }

    const agentId = String(input.agent.id || '').trim();
    if (!agentId) {
      return messages;
    }
    const memoQuery = `${input.task.title}\n${input.task.description}\n${input.task.messages?.slice(-1)[0]?.content || ''}`;
    const relevantMemos = await this.memoService.getTaskMemoryContext(agentId, memoQuery).catch(() => '');
    if (relevantMemos) {
      messages.push({
        role: 'system',
        content:
          `以下是从备忘录中按需检索到的相关记忆（渐进加载摘要）:\n${relevantMemos}\n\n` +
          '请优先参考这些记忆，并在必要时调用 builtin.sys-mg.mcp.agent-memory.list 获取更完整上下文；若有新结论可调用 builtin.sys-mg.mcp.agent-memory.create 追加沉淀。',
        timestamp: new Date(),
      });
    }

    return messages;
  }
}
