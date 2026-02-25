import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type EmployeeDocument = Employee & Document;

export enum EmployeeType {
  HUMAN = 'human',
  AGENT = 'agent',
}

export enum EmployeeStatus {
  ACTIVE = 'active',
  PROBATION = 'probation', // 试用期
  TERMINATED = 'terminated',
  ON_LEAVE = 'on_leave',   // 休假
  SUSPENDED = 'suspended', // 暂停
}

export enum EmployeeRole {
  FOUNDER = 'founder',
  CO_FOUNDER = 'co_founder',
  CEO = 'ceo',
  CTO = 'cto',
  MANAGER = 'manager',
  SENIOR = 'senior',
  JUNIOR = 'junior',
  INTERN = 'intern',
}

@Schema({ timestamps: true })
export class Employee {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  organizationId: string;

  // 员工类型：人类或Agent
  @Prop({ enum: EmployeeType, required: true })
  type: EmployeeType;

  // 如果是人类员工
  @Prop()
  userId?: string;           // 关联的用户ID（如果有登录系统）
  
  @Prop()
  name?: string;             // 人类员工姓名
  
  @Prop()
  email?: string;            // 邮箱
  
  @Prop()
  avatar?: string;           // 头像URL

  // 如果是Agent员工
  @Prop()
  agentId?: string;          // 关联的Agent ID

  // 职位信息
  @Prop({ enum: EmployeeRole, required: true })
  role: EmployeeRole;

  @Prop()
  departmentId?: string;     // 部门ID

  @Prop()
  title?: string;            // 职位名称

  @Prop()
  description?: string;      // 职位描述

  // 入职信息
  @Prop({ default: Date.now })
  joinDate: Date;

  @Prop()
  probationEndDate?: Date;   // 试用期结束日期

  @Prop({ enum: EmployeeStatus, default: EmployeeStatus.PROBATION })
  status: EmployeeStatus;

  // 股权和薪酬
  @Prop({ default: 0 })
  shares: number;            // 持有的股份

  @Prop({ default: 0 })
  stockOptions: number;      // 期权

  @Prop({ default: 0 })
  salary: number;            // 月薪

  // 绩效评估
  @Prop({ type: Object })
  performance?: {
    overallScore: number;              // 综合评分 0-100
    taskCompletionRate: number;        // 任务完成率
    codeQuality: number;               // 代码质量
    collaboration: number;             // 团队协作
    innovation: number;                // 创新能力
    efficiency: number;                // 工作效率
    lastEvaluationDate?: Date;
    totalEvaluations: number;
  };

  // 工作统计
  @Prop({ type: Object })
  statistics?: {
    totalTasks: number;
    completedTasks: number;
    totalTokens: number;
    totalCost: number;
    meetingsAttended: number;
    meetingsHosted: number;
  };

  // 能力标签
  @Prop({ type: [String], default: [] })
  capabilities: string[];

  // 权限和工具
  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ type: [String], default: [] })
  toolAccess: string[];

  // 如果是真实人类，是否允许AI代理
  @Prop({ default: false })
  allowAIProxy?: boolean;    // 允许AI代理参加会议/任务

  @Prop()
  aiProxyAgentId?: string;   // 代理AI的Agent ID

  // 会议室相关设置
  @Prop({ type: Object })
  meetingPreferences?: {
    autoJoin: boolean;       // 自动加入会议
    notifications: boolean;  // 接收通知
    preferredMeetingTypes: string[];
  };

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const EmployeeSchema = SchemaFactory.createForClass(Employee);

// 索引
EmployeeSchema.index({ organizationId: 1 });
EmployeeSchema.index({ type: 1 });
EmployeeSchema.index({ status: 1 });
EmployeeSchema.index({ departmentId: 1 });
EmployeeSchema.index({ userId: 1 });
EmployeeSchema.index({ agentId: 1 });
