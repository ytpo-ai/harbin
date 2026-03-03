import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentRuntimeMaintenanceAuditDocument = AgentRuntimeMaintenanceAudit & Document;

@Schema({ timestamps: true, collection: 'agent_runtime_maintenance_audits' })
export class AgentRuntimeMaintenanceAudit {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, enum: ['dead_letter_requeue', 'purge_legacy'] })
  action: 'dead_letter_requeue' | 'purge_legacy';

  @Prop({ required: true })
  actorId: string;

  @Prop({ required: true })
  actorRole: string;

  @Prop()
  organizationId?: string;

  @Prop({ required: true, default: false })
  dryRun: boolean;

  @Prop({ required: true, default: 0 })
  matched: number;

  @Prop({ required: true, default: 0 })
  affected: number;

  @Prop({ type: Object })
  scope?: Record<string, unknown>;

  @Prop({ type: Object })
  result?: Record<string, unknown>;
}

export const AgentRuntimeMaintenanceAuditSchema = SchemaFactory.createForClass(AgentRuntimeMaintenanceAudit);

AgentRuntimeMaintenanceAuditSchema.index({ createdAt: -1 });
AgentRuntimeMaintenanceAuditSchema.index({ organizationId: 1, createdAt: -1 });
AgentRuntimeMaintenanceAuditSchema.index({ action: 1, createdAt: -1 });
