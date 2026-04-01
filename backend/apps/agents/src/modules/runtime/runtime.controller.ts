import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { GatewayUserContext } from '@libs/contracts';
import { RuntimeOrchestratorService } from './runtime-orchestrator.service';
import { HookDispatcherService } from './hook-dispatcher.service';
import { RuntimePersistenceService } from './runtime-persistence.service';
import { RuntimeEiSyncService } from './runtime-ei-sync.service';
import {
  RuntimeControlBody,
  RuntimeControlBodySchema,
  RuntimeDeadLetterQuery,
  RuntimeDeadLetterQuerySchema,
  RuntimeDeadLetterRequeueBody,
  RuntimeDeadLetterRequeueBodySchema,
  RuntimeMaintenanceAuditQuery,
  RuntimeMaintenanceAuditQuerySchema,
  RuntimeEiSyncDeadLetterQuery,
  RuntimeEiSyncDeadLetterQuerySchema,
  RuntimeEiSyncRequeueBody,
  RuntimeEiSyncRequeueBodySchema,
  RuntimePurgeLegacyBody,
  RuntimePurgeLegacyBodySchema,
  RuntimeReplayBody,
  RuntimeReplayBodySchema,
} from './contracts/runtime-control.contract';

@Controller('agents/runtime')
export class RuntimeController {
  constructor(
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
    private readonly hookDispatcher: HookDispatcherService,
    private readonly persistence: RuntimePersistenceService,
    private readonly runtimeEiSyncService: RuntimeEiSyncService,
  ) {}

  private getUserContext(req: Request & { userContext?: GatewayUserContext }): GatewayUserContext {
    const context = req.userContext;
    if (!context) {
      throw new ForbiddenException('Missing user context');
    }
    return context;
  }

  private assertRuntimeControlPermission(context: GatewayUserContext): void {
    // const role = (context.role || '').toLowerCase();
    // if (role === 'system' || role === 'admin' || role === 'owner' || role === 'founder') {
    //   return;
    // }
    // throw new ForbiddenException('Runtime control requires system/admin/founder role');
  }

  private assertSystemRole(context: GatewayUserContext): void {
    // const role = (context.role || '').toLowerCase();
    // if (role === 'system') {
    //   return;
    // }
    // throw new ForbiddenException('This operation requires system role');
  }

  private assertOrganizationAccess(runOrganizationId: string | undefined, context: GatewayUserContext): void {
    const role = (context.role || '').toLowerCase();
    if (role === 'system') {
      return;
    }
    if (!runOrganizationId) {
      return;
    }
  }

  private async getAuthorizedRun(runId: string, context: GatewayUserContext) {
    const run = await this.runtimeOrchestrator.getRun(runId);
    if (!run) {
      throw new NotFoundException('Runtime run not found');
    }
    return run;
  }

  private toActor(
    context: GatewayUserContext,
    body?: RuntimeControlBody,
  ): { actorId: string; actorType: 'employee' | 'system' | 'agent'; reason?: string } {
    const role = (context.role || '').toLowerCase();
    const actorType =
      body?.actorType ||
      (role === 'system' ? 'system' : 'employee');
    return {
      actorId: body?.actorId || context.employeeId || 'unknown-actor',
      actorType,
      reason: body?.reason,
    };
  }

  private toDateOrUndefined(value?: string): Date | undefined {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed;
  }

  private toPositiveNumberOrUndefined(value?: string): number | undefined {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }
    return Math.floor(parsed);
  }

  @Get('runs')
  async listRuns(
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Query('agentId') agentId: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);

    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
      throw new BadRequestException('agentId is required');
    }

    const result = await this.runtimeOrchestrator.listRuns(normalizedAgentId, {
      status: String(status || '').trim() || undefined,
      from: this.toDateOrUndefined(from),
      to: this.toDateOrUndefined(to),
      page: this.toPositiveNumberOrUndefined(page),
      pageSize: this.toPositiveNumberOrUndefined(pageSize),
    });

    return {
      success: true,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      items: result.items,
    };
  }

  @Get('runs/:runId')
  async getRun(@Param('runId') runId: string, @Req() req: Request & { userContext?: GatewayUserContext }) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    const run = await this.getAuthorizedRun(runId, context);
    return {
      found: Boolean(run),
      run,
    };
  }

  @Get('metrics')
  async getRuntimeMetrics(@Req() req: Request & { userContext?: GatewayUserContext }) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    const [outbox, deadLetter] = await Promise.all([
      this.persistence.countOutboxByStatus(),
      this.persistence.getDeadLetterSummary(),
    ]);
    return {
      hookDispatcher: this.hookDispatcher.getMetrics(),
      outbox,
      deadLetter,
      timestamp: Date.now(),
    };
  }

  @Post('runs/:runId/pause')
  async pauseRun(
    @Param('runId') runId: string,
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body() rawBody?: RuntimeControlBody,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    await this.getAuthorizedRun(runId, context);
    const body = RuntimeControlBodySchema.parse(rawBody || {});
    await this.runtimeOrchestrator.pauseRunWithActor(runId, this.toActor(context, body));
    return { success: true, runId, action: 'paused' };
  }

  @Post('runs/:runId/resume')
  async resumeRun(
    @Param('runId') runId: string,
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body() rawBody?: RuntimeControlBody,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    await this.getAuthorizedRun(runId, context);
    const body = RuntimeControlBodySchema.parse(rawBody || {});
    await this.runtimeOrchestrator.resumeRunWithActor(runId, this.toActor(context, body));
    return { success: true, runId, action: 'resumed' };
  }

  @Post('runs/:runId/cancel')
  async cancelRun(
    @Param('runId') runId: string,
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body() rawBody?: RuntimeControlBody,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    await this.getAuthorizedRun(runId, context);
    const body = RuntimeControlBodySchema.parse(rawBody || {});
    await this.runtimeOrchestrator.cancelRunWithActor(runId, this.toActor(context, body));
    return { success: true, runId, action: 'cancelled' };
  }

  @Post('runs/:runId/replay')
  async replayRun(
    @Param('runId') runId: string,
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body()
    rawBody?: RuntimeReplayBody,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    await this.getAuthorizedRun(runId, context);
    const body = RuntimeReplayBodySchema.parse(rawBody || {});
    const dispatched = await this.runtimeOrchestrator.replayRun(runId, {
      eventTypes: body?.eventTypes,
      fromSequence: body?.fromSequence,
      toSequence: body?.toSequence,
      channel: body?.channel,
      limit: body?.limit,
    });
    return {
      success: true,
      runId,
      action: 'replayed',
      dispatched,
    };
  }

  @Post('runs/:runId/sync-ei-replay')
  async replayRunToEngineeringIntelligence(
    @Param('runId') runId: string,
    @Req() req: Request & { userContext?: GatewayUserContext },
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    await this.getAuthorizedRun(runId, context);
    const result = await this.runtimeEiSyncService.syncRunNow(runId, { replay: true });
    return {
      success: result.success,
      runId,
      action: 'sync_ei_replay',
      reason: result.reason,
    };
  }

  @Get('sync-ei/dead-letter')
  async getEngineeringIntelligenceDeadLetterRuns(
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Query() rawQuery?: RuntimeEiSyncDeadLetterQuery,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    const query = RuntimeEiSyncDeadLetterQuerySchema.parse(rawQuery || {});
    const rows = await this.runtimeEiSyncService.listDeadLetterRuns(query.limit || 100);
    return {
      success: true,
      total: rows.length,
      runs: rows.map((run) => ({
        runId: run.id,
        agentId: run.agentId,
        status: run.status,
        sync: run.sync,
        updatedAt: (run as any).updatedAt,
      })),
    };
  }

  @Post('sync-ei/dead-letter/requeue')
  async requeueEngineeringIntelligenceDeadLetterRuns(
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body() rawBody?: RuntimeEiSyncRequeueBody,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    const body = RuntimeEiSyncRequeueBodySchema.parse(rawBody || {});
    const result = await this.runtimeEiSyncService.requeueDeadLetterRuns(body.runIds, body.limit || 100, Boolean(body.dryRun));
    return {
      success: true,
      dryRun: Boolean(body.dryRun),
      matched: result.matched,
      requeued: result.requeued,
    };
  }

  @Get('outbox/dead-letter')
  async getDeadLetterEvents(
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Query() rawQuery?: RuntimeDeadLetterQuery,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    const query = RuntimeDeadLetterQuerySchema.parse(rawQuery || {});
    const rows = await this.persistence.findDeadLetterEvents({
      limit: query.limit || 200,
      
      runId: query.runId,
      eventType: query.eventType,
    });
    const total = await this.persistence.countDeadLetterEvents({
      
      runId: query.runId,
      eventType: query.eventType,
    });

    return {
      success: true,
      total,
      returned: rows.length,
      hasMore: total > rows.length,
      events: rows.map((row) => ({
        eventId: row.eventId,
        eventType: row.eventType,
        runId: row.runId,
        
        sessionId: row.sessionId,
        sequence: row.sequence,
        attempts: row.attempts,
        lastError: row.lastError,
        nextRetryAt: row.nextRetryAt,
        updatedAt: (row as any).updatedAt,
      })),
    };
  }

  @Post('outbox/dead-letter/requeue')
  async requeueDeadLetterEvents(
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body() rawBody?: RuntimeDeadLetterRequeueBody,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    const body = RuntimeDeadLetterRequeueBodySchema.parse(rawBody || {});
    const batchId = `requeue-${Date.now()}`;

    let requeued = 0;
    let matched = 0;
    if (body.eventIds?.length) {
      const rows = await this.persistence.findDeadLetterEventsByEventIds(body.eventIds);
      const eventIds = rows.map((row) => row.eventId);
      matched = eventIds.length;
      if (!body.dryRun) {
        requeued = await this.persistence.requeueDeadLetterByEventIds(eventIds);
      }
    } else {
      const rows = await this.persistence.findDeadLetterEvents({
        limit: body.limit || 200,
        
        runId: body.runId,
        eventType: body.eventType,
      });
      matched = rows.length;
      if (!body.dryRun) {
        requeued = await this.persistence.requeueDeadLetterByEventIds(rows.map((row) => row.eventId));
      }
    }

    await this.persistence.createMaintenanceAudit({
      action: 'dead_letter_requeue',
      batchId,
      actorId: context.employeeId,
      actorRole: context.role || 'unknown',
      
      dryRun: Boolean(body.dryRun),
      matched,
      affected: requeued,
      summary: `dead_letter_requeue matched=${matched} requeued=${requeued} dryRun=${Boolean(body.dryRun)}`,
      scope: {
        runId: body.runId,
        eventType: body.eventType,
        eventIdsCount: body.eventIds?.length || 0,
      },
      result: {
        requeued,
      },
    });

    return {
      success: true,
      batchId,
      dryRun: Boolean(body.dryRun),
      matched,
      requeued,
      scope: {
        
        runId: body.runId,
        eventType: body.eventType,
      },
    };
  }

  @Get('maintenance/audits')
  async getMaintenanceAudits(
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Query() rawQuery?: RuntimeMaintenanceAuditQuery,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    const query = RuntimeMaintenanceAuditQuerySchema.parse(rawQuery || {});
    const rows = await this.persistence.listMaintenanceAudits({
      limit: query.limit || 50,
      action: query.action,
      
      batchId: query.batchId,
    });

    return {
      success: true,
      total: rows.length,
      audits: rows.map((row) => ({
        id: row.id,
        action: row.action,
        batchId: row.batchId,
        actorId: row.actorId,
        actorRole: row.actorRole,
        
        dryRun: row.dryRun,
        matched: row.matched,
        affected: row.affected,
        summary: row.summary,
        scope: row.scope,
        result: row.result,
        createdAt: (row as any).createdAt,
      })),
    };
  }

  @Post('maintenance/purge-legacy')
  async purgeLegacyRuntimeData(
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body() rawBody: RuntimePurgeLegacyBody,
  ) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    this.assertSystemRole(context);
    const body = RuntimePurgeLegacyBodySchema.parse(rawBody || {});

    const defaultCollections = [
      'agentsessions',
      'agent_sessions',
    ];
    const collections = body.collections?.length ? body.collections : defaultCollections;
    const batchId = `purge-${Date.now()}`;
    const results = body.dryRun
      ? collections.map((collection) => ({ collection, deletedCount: 0 }))
      : await this.persistence.purgeCollections(collections);

    await this.persistence.createMaintenanceAudit({
      action: 'purge_legacy',
      batchId,
      actorId: context.employeeId,
      actorRole: context.role || 'unknown',
      
      dryRun: Boolean(body.dryRun),
      matched: collections.length,
      affected: results.reduce((sum, item) => sum + item.deletedCount, 0),
      summary: `purge_legacy collections=${collections.length} deleted=${results.reduce((sum, item) => sum + item.deletedCount, 0)} dryRun=${Boolean(body.dryRun)}`,
      scope: {
        collections,
      },
      result: {
        collections: results,
      },
    });

    return {
      success: true,
      batchId,
      purgedBy: context.employeeId,
      dryRun: Boolean(body.dryRun),
      collections: results,
    };
  }

  @Get('sessions')
  async listSessions(
    @Query('ownerType') ownerType?: 'agent' | 'employee' | 'system',
    @Query('ownerId') ownerId?: string,
    @Query('status') status?: 'active' | 'archived' | 'closed',
    @Query('sessionType') sessionType?: 'meeting' | 'task' | 'plan' | 'chat',
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const normalizedPage = Math.max(1, Number(page || 1));
    const normalizedPageSize = Math.max(1, Math.min(100, Number(pageSize || 20)));
    const [sessions, total] = await Promise.all([
      this.persistence.listSessions({
        ownerType,
        ownerId: ownerId?.trim() || undefined,
        status,
        sessionType,
        keyword: keyword?.trim() || undefined,
        page: normalizedPage,
        pageSize: normalizedPageSize,
      }),
      this.persistence.countSessions({
        ownerType,
        ownerId: ownerId?.trim() || undefined,
        status,
        sessionType,
        keyword: keyword?.trim() || undefined,
      }),
    ]);

    return {
      total,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
      sessions,
    };
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    const session = await this.persistence.getSessionDetailById(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  @Post('sessions')
  async createSession(
    @Body()
    body: {
      sessionId?: string;
      sessionType?: 'meeting' | 'task' | 'plan' | 'chat';
      ownerType?: 'agent' | 'employee' | 'system';
      ownerId: string;
      title: string;
      planContext?: {
        linkedPlanId?: string;
        currentTaskId?: string;
        completedTaskIds?: string[];
        linkedTaskId?: string;
        latestTaskInput?: string;
        latestTaskOutput?: string;
        lastRunId?: string;
      };
      meetingContext?: {
        meetingId?: string;
        agendaId?: string;
        meetingType?: string;
        latestSummary?: string;
      };
      domainContext?: {
        domainType?: string;
        description?: string;
        constraints?: string[];
        knowledgeRefs?: string[];
        metadata?: Record<string, unknown>;
      };
      collaborationContext?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    },
  ) {
    const session = await this.persistence.ensureSession({
      sessionId: body.sessionId,
      sessionType: body.sessionType || 'task',
      ownerType: body.ownerType || 'agent',
      ownerId: body.ownerId,
      title: body.title,
      planContext: body.planContext,
      meetingContext: body.meetingContext,
      domainContext: body.domainContext,
      collaborationContext: body.collaborationContext,
      metadata: body.metadata,
    });
    return session;
  }

  @Post('sessions/meeting')
  async getOrCreateMeetingSession(
    @Body()
    body: {
      meetingId: string;
      agentId: string;
      title: string;
      meetingContext?: {
        meetingId: string;
        agendaId?: string;
        meetingType?: string;
        latestSummary?: string;
      };
    },
  ) {
    const session = await this.persistence.getOrCreateMeetingSession(
      body.meetingId,
      body.agentId,
      body.title,
      body.meetingContext,
    );
    return session;
  }

  @Post('sessions/plan')
  async getOrCreatePlanSession(
    @Body()
    body: {
      planId: string;
      agentId: string;
      title: string;
      currentTaskId?: string;
      orchestrationRunId?: string;
      domainContext?: {
        domainType?: string;
        description?: string;
        constraints?: string[];
        knowledgeRefs?: string[];
        metadata?: Record<string, unknown>;
      };
      collaborationContext?: Record<string, unknown>;
    },
  ) {
    const session = await this.persistence.getOrCreatePlanSession(
      body.planId,
      body.agentId,
      body.title,
      {
        currentTaskId: body.currentTaskId,
        orchestrationRunId: body.orchestrationRunId,
        domainContext: body.domainContext,
        collaborationContext: body.collaborationContext,
      },
    );
    return session;
  }

  @Post('sessions/task')
  async getOrCreateTaskSession(
    @Body()
    body: {
      taskId: string;
      agentId: string;
      title: string;
      planContext?: {
        linkedPlanId?: string;
        linkedTaskId?: string;
        latestTaskInput?: string;
        latestTaskOutput?: string;
        lastRunId?: string;
      };
    },
  ) {
    const session = await this.persistence.getOrCreateTaskSession(
      body.taskId,
      body.agentId,
      body.title,
      body.planContext,
    );
    return session;
  }

  @Post('sessions/:id/messages')
  async appendMessage(
    @Param('id') id: string,
    @Body()
    body: {
      messageId?: string;
      runId?: string;
      agentId?: string;
      role: 'system' | 'user' | 'assistant' | 'tool';
      content?: unknown;
      status?: 'pending' | 'streaming' | 'completed' | 'error';
      metadata?: Record<string, unknown>;
    },
  ) {
    const messageId = String(body.messageId || '').trim();
    if (messageId) {
      await this.persistence.appendMessageIdToSession(id, messageId);
    } else if (body.runId && body.agentId) {
      await this.persistence.createMessage({
        runId: body.runId,
        agentId: body.agentId,
        sessionId: id,
        role: body.role,
        sequence: 0,
        content: body.content ?? '',
        status: body.status,
        metadata: body.metadata,
      });
    } else {
      throw new NotFoundException('messageId or (runId + agentId) is required');
    }
    const session = await this.persistence.getSessionById(id);
    return session;
  }

  @Get('sessions/:sessionId/messages')
  async getSessionMessages(@Param('sessionId') sessionId: string) {
    const messages = await this.persistence.listSessionMessagesById(sessionId);
    return {
      sessionId,
      total: messages.length,
      messages,
    };
  }

  @Get('messages/:messageId/parts')
  async getMessageParts(@Param('messageId') messageId: string) {
    const parts = await this.persistence.listMessageParts(messageId);
    return {
      messageId,
      total: parts.length,
      parts,
    };
  }

  @Get('runs/:runId/messages')
  async getRunMessages(@Param('runId') runId: string) {
    const messages = await this.persistence.listRunMessagesWithParts(runId);
    return {
      runId,
      total: messages.length,
      messages,
    };
  }

  @Post('sessions/:id/archive')
  async archiveSession(
    @Param('id') id: string,
    @Body() body?: { summary?: string },
  ) {
    await this.persistence.archiveSession(id, body?.summary);
    const session = await this.persistence.getSessionById(id);
    return session;
  }

  @Post('sessions/:id/resume')
  async resumeSession(@Param('id') id: string) {
    await this.persistence.resumeSession(id);
    const session = await this.persistence.getSessionById(id);
    return session;
  }
}
