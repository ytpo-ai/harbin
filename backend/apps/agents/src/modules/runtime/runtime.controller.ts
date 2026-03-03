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
  async pauseRun(@Param('runId') runId: string, @Body() body?: { reason?: string }) {
    await this.runtimeOrchestrator.pauseRun(runId, body?.reason);
    return { success: true, runId, action: 'paused' };
  }

  @Post('runs/:runId/resume')
  async resumeRun(@Param('runId') runId: string, @Body() body?: { reason?: string }) {
    await this.runtimeOrchestrator.resumeRun(runId, body?.reason);
    return { success: true, runId, action: 'resumed' };
  }

  @Post('runs/:runId/cancel')
  async cancelRun(@Param('runId') runId: string, @Body() body?: { reason?: string }) {
    await this.runtimeOrchestrator.cancelRun(runId, body?.reason);
    return { success: true, runId, action: 'cancelled' };
  }

  @Post('runs/:runId/replay')
  async replayRun(@Param('runId') runId: string) {
    const dispatched = await this.runtimeOrchestrator.replayRun(runId);
    return {
      success: true,
      runId,
      action: 'replayed',
      dispatched,
    };
  }
}
