import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { GatewayUserContext } from '@libs/contracts';
import { AgentTaskService } from './agent-task.service';
import {
  CancelAgentTaskBody,
  CancelAgentTaskBodySchema,
  CreateAgentTaskBody,
  CreateAgentTaskBodySchema,
} from './contracts/agent-task.contract';
import { RuntimeSseStreamService } from './runtime-sse-stream.service';

@Controller('agents/tasks')
export class AgentTaskController {
  constructor(
    private readonly taskService: AgentTaskService,
    private readonly sseStreamService: RuntimeSseStreamService,
  ) {}

  private getUserContext(req: Request & { userContext?: GatewayUserContext }): GatewayUserContext {
    const context = req.userContext;
    if (!context?.employeeId) {
      throw new ForbiddenException('Missing user context');
    }
    return context;
  }

  @Post()
  async createTask(
    @Body() rawBody: CreateAgentTaskBody,
    @Req() req: Request & { userContext?: GatewayUserContext },
  ) {
    const body = CreateAgentTaskBodySchema.parse(rawBody || {});
    const context = this.getUserContext(req);
    return this.taskService.createTask(body, context);
  }

  @Get(':taskId')
  async getTask(
    @Param('taskId') taskId: string,
    @Req() req: Request & { userContext?: GatewayUserContext },
  ) {
    const context = this.getUserContext(req);
    const task = await this.taskService.getTask(taskId, context);
    return {
      taskId: task.id,
      runId: task.runId,
      status: task.status,
      progress: task.progress || 0,
      currentStep: task.currentStep,
      error: task.errorMessage,
      resultSummary: task.resultSummary,
      attempt: task.attempt || 0,
      maxAttempts: task.maxAttempts,
      nextRetryAt: task.nextRetryAt,
      lastAttemptAt: task.lastAttemptAt,
      stepTimeoutMs: task.stepTimeoutMs,
      taskTimeoutMs: task.taskTimeoutMs,
      lastEventAt: task.lastEventAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      cancelRequested: Boolean(task.cancelRequested),
      serveId: task.serveId,
    };
  }

  @Post(':taskId/cancel')
  async cancelTask(
    @Param('taskId') taskId: string,
    @Body() rawBody: CancelAgentTaskBody,
    @Req() req: Request & { userContext?: GatewayUserContext },
  ) {
    const body = CancelAgentTaskBodySchema.parse(rawBody || {});
    const context = this.getUserContext(req);
    return this.taskService.cancelTask(taskId, context, body.reason);
  }

  @Sse(':taskId/events')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  streamTaskEvents(
    @Param('taskId') taskId: string,
    @Query('lastEventId') lastEventId: string | undefined,
    @Query('lastSequence') lastSequence: string | undefined,
    @Req() req: Request & { userContext?: GatewayUserContext },
  ): Promise<Observable<MessageEvent>> {
    return this.createTaskEventStream(taskId, lastEventId, lastSequence, req);
  }

  private async createTaskEventStream(
    taskId: string,
    queryLastEventId: string | undefined,
    queryLastSequence: string | undefined,
    req: Request & { userContext?: GatewayUserContext },
  ): Promise<Observable<MessageEvent>> {
    const context = this.getUserContext(req);
    const task = await this.taskService.getTask(taskId, context);

    const header = req.headers['last-event-id'];
    const headerLastEventId = Array.isArray(header) ? header[0] : header;
    const lastEventId = queryLastEventId || headerLastEventId;
    const replayFromEventId = String(lastEventId || '').trim() || undefined;
    const parsedLastSequence = Number(queryLastSequence);
    const replaySequence = Number.isFinite(parsedLastSequence) && parsedLastSequence >= 0 ? parsedLastSequence : undefined;
    const effectiveLastSequence = await this.taskService.resolveLastSequence(task.id, replaySequence, replayFromEventId);
    const replay = await this.taskService.getReplayEvents(task, {
      lastSequence: effectiveLastSequence,
      lastEventId: effectiveLastSequence > 0 ? undefined : replayFromEventId,
    });
    return this.sseStreamService.createTaskSseStream({
      taskId: task.id,
      replay,
    });
  }
}
