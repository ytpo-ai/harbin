import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type MeetingDocument = Meeting & Document;

export enum MeetingType {
  WEEKLY = 'weekly',           // 周会
  BOARD = 'board',             // 董事会
  DAILY = 'daily',             // 日常讨论
  DEPARTMENT = 'department',   // 部门会议
  AD_HOC = 'ad_hoc',           // 临时会议
  PROJECT = 'project',         // 项目会议
  EMERGENCY = 'emergency',     // 紧急会议
}

export enum MeetingStatus {
  PENDING = 'pending',         // 待开始
  ACTIVE = 'active',           // 进行中
  PAUSED = 'paused',           // 已暂停
  ENDED = 'ended',             // 已结束
}

export enum ParticipantRole {
  HOST = 'host',               // 主持人
  PARTICIPANT = 'participant', // 参与者
  OBSERVER = 'observer',       // 观察者
}

@Schema({ timestamps: true })
export class MeetingParticipant {
  @Prop({ required: true })
  agentId: string;

  @Prop({ enum: ParticipantRole, default: ParticipantRole.PARTICIPANT })
  role: ParticipantRole;

  @Prop({ default: false })
  isPresent: boolean;          // 是否在场

  @Prop({ default: false })
  hasSpoken: boolean;          // 是否发过言

  @Prop({ default: 0 })
  messageCount: number;        // 发言次数

  @Prop()
  joinedAt?: Date;

  @Prop()
  leftAt?: Date;
}

@Schema()
export class MeetingMessage {
  @Prop({ default: () => uuidv4() })
  id: string;

  @Prop({ required: true })
  agentId: string;

  @Prop({ required: true })
  content: string;

  @Prop({ 
    enum: ['opinion', 'question', 'agreement', 'disagreement', 'suggestion', 'conclusion', 'introduction', 'action_item'],
    default: 'opinion'
  })
  type: string;

  @Prop({ default: Date.now })
  timestamp: Date;

  @Prop({ type: Object })
  metadata?: {
    mentionedAgents?: string[];    // @提及的agent
    relatedMessageId?: string;     // 回复的消息ID
    sentiment?: 'positive' | 'neutral' | 'negative';
    confidence?: number;           // AI置信度
  };
}

@Schema({ timestamps: true })
export class Meeting {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ enum: MeetingType, required: true })
  type: MeetingType;

  @Prop({ enum: MeetingStatus, default: MeetingStatus.PENDING })
  status: MeetingStatus;

  @Prop({ required: true })
  hostId: string;                // 主持人(agent ID)

  @Prop({ type: [MeetingParticipant], default: [] })
  participants: MeetingParticipant[];

  @Prop({ type: [MeetingMessage], default: [] })
  messages: MeetingMessage[];

  @Prop()
  agenda?: string;               // 会议议程

  @Prop()
  scheduledStartTime?: Date;     // 计划开始时间

  @Prop()
  startedAt?: Date;              // 实际开始时间

  @Prop()
  endedAt?: Date;                // 结束时间

  @Prop({ type: [String], default: [] })
  invitedAgentIds: string[];     // 已邀请但未加入的agents

  @Prop({ type: Object })
  settings?: {
    maxParticipants?: number;
    allowAutoStart?: boolean;    // 是否允许自动开始
    aiModeration?: boolean;      // AI moderation
    recordTranscript?: boolean;  // 是否记录文字记录
    autoEndOnSilence?: number;   // 静音多久自动结束(分钟)
    speakingOrder?: 'free' | 'sequential' | 'round_robin';  // 发言顺序
  };

  @Prop({ type: Object })
  summary?: {
    content: string;
    actionItems: string[];
    decisions: string[];
    generatedAt: Date;
  };

  @Prop({ default: 0 })
  messageCount: number;
}

export const MeetingSchema = SchemaFactory.createForClass(Meeting);

// 索引
MeetingSchema.index({ status: 1 });
MeetingSchema.index({ type: 1 });
MeetingSchema.index({ hostId: 1 });
MeetingSchema.index({ 'participants.agentId': 1 });
MeetingSchema.index({ createdAt: -1 });
