import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RuntimeOrchestratorService } from './runtime-orchestrator.service';

@Controller('agents/runtime')
export class RuntimeController {
  constructor(private readonly runtimeOrchestrator: RuntimeOrchestratorService) {}

  @Get('runs/:runId')
  async getRun(@Param('runId') runId: string) {
    const run = await this.runtimeOrchestrator.getRun(runId);
    return {
      found: Boolean(run),
      run,
    };
  }

  @Post('runs/:runId/pause')
  async pauseRun(
    @Param('runId') runId: string,
    @Body() body?: { reason?: string; actorId?: string; actorType?: 'employee' | 'system' | 'agent' },
  ) {
    await this.runtimeOrchestrator.pauseRunWithActor(runId, {
      reason: body?.reason,
      actorId: body?.actorId,
      actorType: body?.actorType,
    });
    return { success: true, runId, action: 'paused' };
  }

  @Post('runs/:runId/resume')
  async resumeRun(
    @Param('runId') runId: string,
    @Body() body?: { reason?: string; actorId?: string; actorType?: 'employee' | 'system' | 'agent' },
  ) {
    await this.runtimeOrchestrator.resumeRunWithActor(runId, {
      reason: body?.reason,
      actorId: body?.actorId,
      actorType: body?.actorType,
    });
    return { success: true, runId, action: 'resumed' };
  }

  @Post('runs/:runId/cancel')
  async cancelRun(
    @Param('runId') runId: string,
    @Body() body?: { reason?: string; actorId?: string; actorType?: 'employee' | 'system' | 'agent' },
  ) {
    await this.runtimeOrchestrator.cancelRunWithActor(runId, {
      reason: body?.reason,
      actorId: body?.actorId,
      actorType: body?.actorType,
    });
    return { success: true, runId, action: 'cancelled' };
  }

  @Post('runs/:runId/replay')
  async replayRun(
    @Param('runId') runId: string,
    @Body()
    body?: {
      eventTypes?: string[];
      fromSequence?: number;
      toSequence?: number;
      channel?: string;
      limit?: number;
    },
  ) {
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
