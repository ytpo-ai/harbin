import { Body, Controller, ForbiddenException, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { GatewayUserContext } from '@libs/contracts';
import { RuntimeOrchestratorService } from './runtime-orchestrator.service';
import { HookDispatcherService } from './hook-dispatcher.service';
import { RuntimePersistenceService } from './runtime-persistence.service';
import { RuntimeControlBody, RuntimeControlBodySchema, RuntimeReplayBody, RuntimeReplayBodySchema } from './contracts/runtime-control.contract';

@Controller('agents/runtime')
export class RuntimeController {
  constructor(
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
    private readonly hookDispatcher: HookDispatcherService,
    private readonly persistence: RuntimePersistenceService,
  ) {}

  private getUserContext(req: Request & { userContext?: GatewayUserContext }): GatewayUserContext {
    const context = req.userContext;
    if (!context) {
      throw new ForbiddenException('Missing user context');
    }
    return context;
  }

  private assertRuntimeControlPermission(context: GatewayUserContext): void {
    const role = (context.role || '').toLowerCase();
    if (role === 'system' || role === 'admin' || role === 'owner') {
      return;
    }
    throw new ForbiddenException('Runtime control requires system/admin role');
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

  @Get('runs/:runId')
  async getRun(@Param('runId') runId: string, @Req() req: Request & { userContext?: GatewayUserContext }) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    const run = await this.runtimeOrchestrator.getRun(runId);
    return {
      found: Boolean(run),
      run,
    };
  }

  @Get('metrics')
  async getRuntimeMetrics(@Req() req: Request & { userContext?: GatewayUserContext }) {
    const context = this.getUserContext(req);
    this.assertRuntimeControlPermission(context);
    const outbox = await this.persistence.countOutboxByStatus();
    return {
      hookDispatcher: this.hookDispatcher.getMetrics(),
      outbox,
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
}
