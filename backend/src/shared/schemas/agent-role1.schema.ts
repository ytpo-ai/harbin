import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AGENT_ROLE_TIERS, AgentRoleTier } from '../role-tier';

export type AgentRoleDocument = AgentRole & Document;

export type AgentRoleStatus = 'active' | 'inactive';

@Schema({ timestamps: true, collection: 'agent_roles' })
export class AgentRole {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  id: string;

  @Prop({ required: true, unique: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ enum: AGENT_ROLE_TIERS, default: 'operations', index: true })
  tier: AgentRoleTier;

  @Prop({ default: '', trim: true })
  description?: string;

  @Prop({ type: [String], default: [] })
  capabilities: string[];

  @Prop({ type: [String], default: [] })
  tools: string[];

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ type: [String], default: [] })
  permissionsManual: string[];

  @Prop({ type: [String], default: [] })
  permissionsDerived: string[];

  @Prop({ default: false })
  exposed: boolean;

  @Prop({ default: '', trim: true })
  promptTemplate?: string;

  @Prop({ enum: ['active', 'inactive'], default: 'active' })
  status: AgentRoleStatus;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const AgentRoleSchema = SchemaFactory.createForClass(AgentRole);

AgentRoleSchema.index({ code: 1 }, { unique: true });
AgentRoleSchema.index({ status: 1 });
