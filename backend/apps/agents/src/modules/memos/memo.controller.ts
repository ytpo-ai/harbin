import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { GatewayUserContext } from '@libs/contracts';
import { MemoKind, MemoType } from '../../schemas/agent-memo.schema';
import { MemoService } from './memo.service';
import { IdentityAggregationService } from './identity-aggregation.service';
import { EvaluationAggregationService } from './evaluation-aggregation.service';

type TaskSourceType = 'orchestration_task' | 'meeting_chat' | 'runtime_note';
type TodoStatus =
  | 'pending'
  | 'queued'
  | 'scheduled'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'in_progress'
  | 'completed';

@Controller('memos')
export class MemoController {
  constructor(
    private readonly memoService: MemoService,
    private readonly identityAggregationService: IdentityAggregationService,
    private readonly evaluationAggregationService: EvaluationAggregationService,
  ) {}

  private getActorContext(req: Request & { userContext?: GatewayUserContext }): { employeeId?: string; role?: string } {
    const context = req.userContext;
    return {
      employeeId: context?.employeeId,
      role: context?.role,
    };
  }

  @Get()
  async listMemos(
    @Query('agentId') agentId?: string,
    @Query('memoType') memoType?: MemoType,
    @Query('memoKind') memoKind?: MemoKind,
    @Query('topic') topic?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.memoService.listMemos({
      agentId,
      memoType,
      memoKind,
      topic,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('search')
  async searchMemos(
    @Body()
    body: {
      agentId: string;
      query: string;
      memoType?: MemoType;
      memoKind?: MemoKind;
      topic?: string;
      limit?: number;
      progressive?: boolean;
      detail?: boolean;
    },
  ) {
    return this.memoService.searchMemos(body.agentId, body.query, {
      memoType: body.memoType,
      memoKind: body.memoKind,
      topic: body.topic,
      limit: body.limit,
      progressive: body.progressive,
      detail: body.detail,
    });
  }

  @Post()
  async createMemo(
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body()
    body: {
      agentId: string;
      title: string;
      content: string;
      memoType?: MemoType;
      memoKind?: MemoKind;
      payload?: Record<string, any>;
      tags?: string[];
      contextKeywords?: string[];
      source?: string;
    },
  ) {
    return this.memoService.createMemo(body, { actor: this.getActorContext(req) });
  }

  @Post('behavior')
  async recordBehavior(
    @Body()
    body: {
      agentId: string;
      event: 'task_start' | 'decision' | 'task_complete' | 'task_failed';
      taskId?: string;
      title?: string;
      details: string;
      tags?: string[];
      topic?: string;
    },
  ) {
    return this.memoService.recordBehavior(body);
  }

  @Post('events/flush')
  async flushEvents(@Body() body?: { agentId?: string }) {
    return this.memoService.flushEventQueue(body?.agentId);
  }

  @Get('aggregation/status')
  async getAggregationStatus(@Query('agentId') agentId?: string) {
    return this.memoService.getAggregationStatus(agentId);
  }

  @Post('repair/core-docs')
  async repairCoreDocs(@Body() body?: { agentId?: string }) {
    return this.memoService.repairCoreDocuments(body?.agentId);
  }

  @Post('todos/upsert')
  async upsertTodo(
    @Body()
    body: {
      agentId: string;
      task: {
        id?: string;
        title?: string;
        description?: string;
        status?: TodoStatus;
        note?: string;
        sourceType?: TaskSourceType;
        orchestrationId?: string;
        priority?: 'low' | 'medium' | 'high';
      };
    },
  ) {
    return this.memoService.upsertTaskTodo(body.agentId, body.task || {});
  }

  @Put('todos/:id/status')
  async updateTodoStatus(
    @Param('id') id: string,
    @Body() body: { status: TodoStatus; note?: string; taskId?: string; sourceType?: TaskSourceType },
  ) {
    return this.memoService.updateTodoStatus(id, body.status, body.note, {
      taskId: body.taskId,
      sourceType: body.sourceType,
    });
  }

  @Get(':id/versions')
  async listMemoVersions(@Param('id') id: string) {
    return this.memoService.listMemoVersions(id);
  }

  @Get('agents/:agentId/context')
  async getTaskContext(@Param('agentId') agentId: string, @Query('taskText') taskText?: string) {
    const context = await this.memoService.getTaskMemoryContext(agentId, taskText || '');
    return { agentId, taskText: taskText || '', context };
  }

  @Post('docs/rebuild')
  async rebuildDocs() {
    return this.memoService.rebuildMemoDocs();
  }

  @Post('identity/aggregate')
  async aggregateIdentity(@Body() body: { agentId: string }) {
    await this.identityAggregationService.aggregateIdentity(body.agentId);
    return { success: true, agentId: body.agentId, type: 'identity' };
  }

  @Post('evaluation/aggregate')
  async aggregateEvaluation(@Body() body: { agentId: string }) {
    await this.evaluationAggregationService.aggregateEvaluation(body.agentId);
    return { success: true, agentId: body.agentId, type: 'evaluation' };
  }

  @Get(':id')
  async getMemo(@Param('id') id: string) {
    return this.memoService.getMemoById(id);
  }

  @Put(':id')
  async updateMemo(
    @Param('id') id: string,
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body() updates: Record<string, any>,
  ) {
    return this.memoService.updateMemo(id, updates, { actor: this.getActorContext(req) });
  }

  @Delete(':id')
  async deleteMemo(@Param('id') id: string) {
    return this.memoService.deleteMemo(id);
  }
}
