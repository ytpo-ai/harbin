import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { MemoKind, MemoTodoStatus, MemoType } from '../../schemas/agent-memo.schema';
import { MemoService } from './memo.service';

@Controller('memos')
export class MemoController {
  constructor(private readonly memoService: MemoService) {}

  @Get()
  async listMemos(
    @Query('agentId') agentId?: string,
    @Query('category') category?: string,
    @Query('memoType') memoType?: MemoType,
    @Query('memoKind') memoKind?: MemoKind,
    @Query('topic') topic?: string,
    @Query('todoStatus') todoStatus?: MemoTodoStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.memoService.listMemos({
      agentId,
      category,
      memoType,
      memoKind,
      topic,
      todoStatus,
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
      category?: string;
      memoType?: MemoType;
      memoKind?: MemoKind;
      topic?: string;
      limit?: number;
      progressive?: boolean;
      detail?: boolean;
    },
  ) {
    return this.memoService.searchMemos(body.agentId, body.query, {
      category: body.category,
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
    @Body()
    body: {
      agentId: string;
      category?: string;
      title: string;
      content: string;
      memoType?: MemoType;
      memoKind?: MemoKind;
      topic?: string;
      todoStatus?: MemoTodoStatus;
      tags?: string[];
      contextKeywords?: string[];
      source?: string;
      taskId?: string;
    },
  ) {
    return this.memoService.createMemo(body);
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

  @Post('todos/upsert')
  async upsertTodo(@Body() body: { agentId: string; task: { id?: string; title?: string; description?: string } }) {
    return this.memoService.upsertTaskTodo(body.agentId, body.task || {});
  }

  @Put('todos/:id/status')
  async updateTodoStatus(@Param('id') id: string, @Body() body: { status: MemoTodoStatus; note?: string }) {
    return this.memoService.updateTodoStatus(id, body.status, body.note);
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

  @Get(':id')
  async getMemo(@Param('id') id: string) {
    return this.memoService.getMemoById(id);
  }

  @Put(':id')
  async updateMemo(@Param('id') id: string, @Body() updates: Record<string, any>) {
    return this.memoService.updateMemo(id, updates);
  }

  @Delete(':id')
  async deleteMemo(@Param('id') id: string) {
    return this.memoService.deleteMemo(id);
  }
}
