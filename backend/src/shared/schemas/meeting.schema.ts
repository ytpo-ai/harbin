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
  ONE_ON_ONE = 'one_on_one',   // 一对一对话
  PROJECT = 'project',         // 项目会议
  EMERGENCY = 'emergency',     // 紧急会议
}

export enum MeetingStatus {
  PENDING = 'pending',         // 待开始
  ACTIVE = 'active',           // 进行中
  PAUSED = 'paused',           // 已暂停
  ENDED = 'ended',             // 已结束
  ARCHIVED = 'archived',       // 已归档
}

export enum ParticipantRole {
  HOST = 'host',               // 主持人
  PARTICIPANT = 'participant', // 参与者
  OBSERVER = 'observer',       // 观察者
}

@Schema({ timestamps: true })
export class MeetingParticipant {
  @Prop({ required: true })
  participantId: string;        // 可以是 employeeId 或 agentId

  @Prop({ enum: ['employee', 'agent'], required: true })
  participantType: 'employee' | 'agent';  // 参与者类型

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

  /**
   * @deprecated Only kept for legacy meeting participant compatibility.
   */
  @Prop({ default: false })
  isExclusiveAssistant?: boolean;

  /**
   * @deprecated Only kept for legacy meeting participant compatibility.
   */
  @Prop()
  assistantForEmployeeId?: string;
}

@Schema()
export class MeetingMessage {
  @Prop({ default: () => uuidv4() })
  id: string;

  @Prop({ required: true })
  senderId: string;              // 发送者ID（employeeId 或 agentId）

  @Prop({ enum: ['employee', 'agent', 'system'], required: true })
  senderType: 'employee' | 'agent' | 'system';  // 发送者类型

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
    mentionedParticipants?: Array<{ id: string; type: 'employee' | 'agent' }>;    // @提及的参与者
    relatedMessageId?: string;     // 回复的消息ID
    sentiment?: 'positive' | 'neutral' | 'negative';
    confidence?: number;           // AI置信度
    /** @deprecated Only kept for legacy proxied message compatibility. */
    isAIProxy?: boolean;          // 是否AI代理发送的消息（人类员工的代理）
    /** @deprecated Only kept for legacy proxied message compatibility. */
    proxyForEmployeeId?: string;   // 如果是AI代理，代理哪个员工
    /** @deprecated Pause metadata is retained for backward compatibility. */
    pendingResponsePaused?: boolean; // 是否暂停等待回复
    /** @deprecated Pause metadata is retained for backward compatibility. */
    pendingResponsePausedAt?: string; // 暂停时间
    source?: 'feishu' | 'web' | 'system' | string;
  };
}

@Schema({ timestamps: true, collection: 'meetings' })
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
  hostId: string;                // 主持人ID（employeeId 或 agentId）

  @Prop({ enum: ['employee', 'agent'], required: true })
  hostType: 'employee' | 'agent';  // 主持人类型

  @Prop({ type: [{ participantId: String, participantType: String, role: String, isPresent: Boolean, hasSpoken: Boolean, messageCount: Number, joinedAt: Date, leftAt: Date, isExclusiveAssistant: Boolean, assistantForEmployeeId: String }], default: [] })
  participants: Array<{
    participantId: string;
    participantType: 'employee' | 'agent';
    role: ParticipantRole;
    isPresent: boolean;
    hasSpoken: boolean;
    messageCount: number;
    joinedAt?: Date;
    leftAt?: Date;
    isExclusiveAssistant?: boolean;
    assistantForEmployeeId?: string;
  }>;

  @Prop({ type: [Object], default: [] })
  messages: Array<{
    id: string;
    senderId: string;
    senderType: string;
    content: string;
    type: string;
    timestamp: Date;
    metadata?: any;
  }>;

  @Prop()
  agenda?: string;               // 会议议程

  @Prop()
  scheduledStartTime?: Date;     // 计划开始时间

  @Prop()
  startedAt?: Date;              // 实际开始时间

  @Prop()
  endedAt?: Date;                // 结束时间

  @Prop({ type: [{ participantId: String, participantType: String }], default: [] })
  invitedParticipants: Array<{
    participantId: string;
    participantType: 'employee' | 'agent';
  }>;     // 已邀请但未加入的参与者

  @Prop({ type: Object })
  settings?: {
    maxParticipants?: number;
    allowAutoStart?: boolean;    // 是否允许自动开始
    aiModeration?: boolean;      // AI moderation
    recordTranscript?: boolean;  // 是否记录文字记录
    autoEndOnSilence?: number;   // 静音多久自动结束(分钟)
    speakingOrder?: 'free' | 'ordered';  // 发言模式：自由讨论/有序发言
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

  @Prop({ index: true })
  projectId?: string; // 所属项目ID
}

export const MeetingSchema = SchemaFactory.createForClass(Meeting);

// 索引
MeetingSchema.index({ status: 1 });
MeetingSchema.index({ type: 1 });
MeetingSchema.index({ hostId: 1 });
MeetingSchema.index({ 'participants.participantId': 1 });
MeetingSchema.index({ createdAt: -1 });
MeetingSchema.index({ projectId: 1, createdAt: -1 });
