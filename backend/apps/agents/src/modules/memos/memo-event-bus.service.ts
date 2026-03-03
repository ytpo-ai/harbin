import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { MemoKind } from '../../schemas/agent-memo.schema';

export type MemoDomainEventName = 'agent.updated' | 'agent.skill_changed' | 'task.completed';

export interface MemoDomainEvent {
  name: MemoDomainEventName;
  agentId: string;
  memoKinds?: MemoKind[];
  taskId?: string;
  summary?: string;
}

@Injectable()
export class MemoEventBusService {
  private readonly emitter = new EventEmitter();

  emit(event: MemoDomainEvent): void {
    this.emitter.emit(event.name, event);
  }

  on(name: MemoDomainEventName, listener: (event: MemoDomainEvent) => void): void {
    this.emitter.on(name, listener);
  }

  off(name: MemoDomainEventName, listener: (event: MemoDomainEvent) => void): void {
    this.emitter.off(name, listener);
  }
}
