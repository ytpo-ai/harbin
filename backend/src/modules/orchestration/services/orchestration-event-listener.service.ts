import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORCH_EVENTS, OrchestrationAdvanceEvent } from '../orchestration-events';
import { OrchestrationStepDispatcherService } from './orchestration-step-dispatcher.service';

@Injectable()
export class OrchestrationEventListenerService {
  private readonly logger = new Logger(OrchestrationEventListenerService.name);

  constructor(private readonly dispatcher: OrchestrationStepDispatcherService) {}

  @OnEvent(ORCH_EVENTS.ADVANCE_REQUESTED, { async: true })
  async handleAdvanceRequested(event: OrchestrationAdvanceEvent): Promise<void> {
    const planId = String(event?.planId || '').trim();
    if (!planId) {
      return;
    }
    try {
      await this.dispatcher.advanceOnce(planId, {
        source: event.source,
        targetPhase: event.targetPhase,
      });
    } catch (error) {
      this.logger.warn(
        `handleAdvanceRequested failed for plan ${planId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
