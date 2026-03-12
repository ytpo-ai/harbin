import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiOpenCodeEventFactDocument = EiOpenCodeEventFact & Document;

@Schema({ timestamps: true, collection: 'ei_opencode_event_facts' })
export class EiOpenCodeEventFact {
  @Prop({ required: true })
  runId: string;

  @Prop({ required: true })
  eventId: string;

  @Prop({ required: true })
  sequence: number;

  @Prop({ required: true })
  eventType: string;

  @Prop({ required: true })
  eventTimestamp: Date;

  @Prop({ required: true })
  envId: string;

  @Prop({ required: true })
  nodeId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  roleCode?: string;

  @Prop()
  payloadDigest?: string;

  @Prop({ required: true })
  syncBatchId: string;

  @Prop({ type: Object })
  rawEvent?: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EiOpenCodeEventFactSchema = SchemaFactory.createForClass(EiOpenCodeEventFact);

EiOpenCodeEventFactSchema.index({ runId: 1, eventId: 1 }, { unique: true });
EiOpenCodeEventFactSchema.index({ runId: 1, sequence: 1 }, { unique: true });
EiOpenCodeEventFactSchema.index({ runId: 1, eventTimestamp: 1 });
