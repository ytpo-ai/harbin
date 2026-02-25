import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type InvitationDocument = Invitation & Document;

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum InvitationRole {
  FOUNDER = 'founder',
  CO_FOUNDER = 'co_founder',
  MANAGER = 'manager',
  SENIOR = 'senior',
  JUNIOR = 'junior',
  INTERN = 'intern',
}

@Schema({ timestamps: true })
export class Invitation {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  organizationId: string;

  // 邀请码（简短易读）
  @Prop({ required: true, unique: true })
  code: string;

  // 邀请人
  @Prop({ required: true })
  invitedBy: string;           // 邀请人employeeId
  
  @Prop({ required: true })
  invitedByName: string;       // 邀请人名称

  // 被邀请人信息
  @Prop()
  email?: string;             // 被邀请人邮箱（可选）

  @Prop()
  name?: string;              // 邀请的姓名（可选）

  // 邀请的角色
  @Prop({ enum: InvitationRole, required: true })
  role: InvitationRole;

  @Prop()
  departmentId?: string;       // 部门ID

  @Prop()
  title?: string;             // 职位名称

  @Prop()
  message?: string;           // 邀请附言

  // 邀请链接
  @Prop({ required: true })
  linkToken: string;          // 链接Token

  @Prop({ required: true })
  expiresAt: Date;           // 过期时间

  @Prop({ enum: InvitationStatus, default: InvitationStatus.PENDING })
  status: InvitationStatus;

  // 使用信息
  @Prop()
  usedAt?: Date;              // 使用时间

  @Prop()
  usedBy?: string;            // 使用者employeeId

  // 设置密码（首次登录时）
  @Prop()
  passwordSetAt?: Date;

  // 最大使用次数（默认1次）
  @Prop({ default: 1 })
  maxUses: number;

  @Prop({ default: 0 })
  usedCount: number;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);

// 索引
InvitationSchema.index({ organizationId: 1 });
InvitationSchema.index({ code: 1 });
InvitationSchema.index({ linkToken: 1 });
InvitationSchema.index({ expiresAt: 1 });
InvitationSchema.index({ status: 1 });
