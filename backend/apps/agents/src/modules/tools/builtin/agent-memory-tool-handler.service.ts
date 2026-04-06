import { Injectable } from '@nestjs/common';
import { MemoService } from '../../memos/memo.service';
import { MemoWriteQueueService } from '../../memos/memo-write-queue.service';
import { ToolExecutionContext } from '../tool-execution-context.type';

@Injectable()
export class MemoToolHandler {
  constructor(
    private readonly memoService: MemoService,
    private readonly memoWriteQueue: MemoWriteQueueService,
  ) {}

  async searchMemoMemory(
    params: { query?: string; memoType?: 'knowledge' | 'standard'; limit?: number; detail?: boolean },
    agentId?: string,
  ): Promise<any> {
    if (!agentId) {
      throw new Error('memo_mcp_search requires agentId');
    }

    const query = params?.query?.trim() || '';
    const memories = await this.memoService.searchMemos(agentId, query, {
      memoType: params?.memoType,
      limit: params?.limit,
      progressive: true,
      detail: params?.detail === true,
    });

    return {
      agentId,
      query,
      total: memories.length,
      memories,
      fetchedAt: new Date().toISOString(),
    };
  }
  async appendMemoMemory(
    params: {
      targetAgentId?: string;
      agentId?: string;
      memoId?: string;
      title?: string;
      content?: string;
      memoKind?: 'identity' | 'todo' | 'topic' | 'history' | 'draft' | 'custom' | 'evaluation' | 'achievement' | 'criticism';
      memoType?: 'knowledge' | 'standard';
      taskId?: string;
      topic?: string;
      tags?: string[];
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    if (!agentId) {
      throw new Error('memo_mcp_append requires agentId');
    }
    if (!params?.content?.trim()) {
      throw new Error('memo_mcp_append requires content');
    }

    const resolvedTargetAgentId = String(params.targetAgentId || params.agentId || '').trim() || agentId;
    const requestedKind = params.memoKind;
    const requestedType = params.memoType;

    if ((requestedKind === 'achievement' || requestedKind === 'criticism') && !String(params.targetAgentId || params.agentId || '').trim()) {
      throw new Error('memo_mcp_append requires targetAgentId for achievement/criticism');
    }

    if (requestedType === 'standard' && !requestedKind) {
      throw new Error('memo_mcp_append requires memoKind when memoType=standard');
    }

    if (requestedKind === 'topic' && requestedType && requestedType !== 'knowledge') {
      throw new Error('memo_mcp_append requires memoType=knowledge when memoKind=topic');
    }

    if ((requestedKind === 'achievement' || requestedKind === 'criticism') && requestedType && requestedType !== 'standard') {
      throw new Error(`memo_mcp_append requires memoType=standard when memoKind=${requestedKind}`);
    }

    const actor = this.resolveMemoActorContext(executionContext);

    if (params.memoId) {
      const existing = await this.memoService.getMemoById(params.memoId);
      if (existing.agentId !== resolvedTargetAgentId) {
        throw new Error('memo_mcp_append memoId owner mismatch with targetAgentId');
      }
      const useDivider = existing.memoKind === 'achievement' || existing.memoKind === 'criticism';
      const existingContent = String(existing.content || '').trim();
      const nextContent = params.content.trim();
      const queued = await this.memoWriteQueue.queueUpdateMemo(existing.id, {
        content: useDivider
          ? existingContent
            ? `${existingContent}\n\n—\n\n${nextContent}`
            : nextContent
          : `${existing.content}\n\n${nextContent}`,
        tags: Array.from(new Set([...(existing.tags || []), ...((params.tags || []).filter(Boolean))])),
      },
      {
        actor,
        skipRolePermissionCheck: true,
      });
      return {
        action: 'queued_update',
        memoId: existing.id,
        requestId: queued.requestId,
      };
    }

    const queued = await this.memoWriteQueue.queueCreateMemo({
      agentId: resolvedTargetAgentId,
      title: params.title?.trim() || 'Runtime memo',
      content: params.content.trim(),
      memoKind: params.memoKind,
      memoType: params.memoType || 'knowledge',
      payload: {
        taskId: params.taskId,
        topic: params.topic || 'runtime',
      },
      tags: params.tags || [],
      source: 'memo_mcp_append',
    },
    {
      actor,
      skipRolePermissionCheck: true,
    });

    return {
      action: 'queued_create',
      requestId: queued.requestId,
    };
  }
  private resolveMemoActorContext(
    executionContext?: ToolExecutionContext,
  ): {
    employeeId?: string;
    role?: string;
  } | undefined {
    const collaborationContext = executionContext?.collaborationContext || {};
    const employeeId = String(
      executionContext?.actor?.employeeId ||
        collaborationContext.employeeId ||
        collaborationContext.initiatorId ||
        collaborationContext.triggeredBy ||
        collaborationContext.userId ||
        '',
    ).trim();
    const role = String(
      executionContext?.actor?.role ||
        collaborationContext.role ||
        collaborationContext.actorRole ||
        collaborationContext.initiatorRole ||
        collaborationContext.userRole ||
        '',
    ).trim();

    if (!employeeId && !role) {
      return undefined;
    }

    return {
      ...(employeeId ? { employeeId } : {}),
      ...(role ? { role } : {}),
    };
  }}
