import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrganizationDocument = Organization & Document;

@Schema({ timestamps: true })
export class Organization {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true, default: Date.now })
  foundedDate: Date;

  @Prop({ required: true, default: 1000000 }) // 100万股
  totalShares: number;

  @Prop({ type: Object })
  shareDistribution: {
    founder: {
      userId: string;
      shares: number;
      percentage: number;
      type: 'human' | 'agent';
    };
    cofounders: {
      agentId: string;
      shares: number;
      percentage: number;
    }[];
    employeePool: {
      totalShares: number;
      percentage: number;
      allocatedShares: number;
      availableShares: number;
    };
  };

  @Prop({ type: [{
    id: String,
    title: String,
    description: String,
    department: String,
    level: { type: String, enum: ['junior', 'senior', 'lead', 'manager', 'executive'] },
    requiredTools: [String],
    requiredCapabilities: [String],
    maxEmployees: Number,
    salaryRange: {
      min: Number,
      max: Number
    },
    stockOptions: Number
  }] })
  roles: {
    id: string;
    title: string;
    description: string;
    department: string;
    level: 'junior' | 'senior' | 'lead' | 'manager' | 'executive';
    requiredTools: string[];
    requiredCapabilities: string[];
    maxEmployees?: number;
    salaryRange: {
      min: number;
      max: number;
    };
    stockOptions?: number;
  }[];

  @Prop({ type: [{
    id: String,
    agentId: String,
    roleId: String,
    joinDate: Date,
    status: { type: String, enum: ['active', 'probation', 'terminated'], default: 'probation' },
    performance: [{
      id: String,
      evaluationDate: Date,
      kpis: {
        taskCompletionRate: Number,
        codeQuality: Number,
        collaboration: Number,
        innovation: Number,
        efficiency: Number
      },
      tokenConsumption: {
        total: Number,
        cost: Number
      },
      completedTasks: Number,
      earnings: Number,
      notes: String,
      evaluator: String
    }],
    salary: Number,
    stockOptions: Number,
    totalShares: Number,
    lastEvaluationDate: Date,
    terminationReason: String
  }] })
  employees: {
    id: string;
    agentId: string;
    roleId: string;
    joinDate: Date;
    status: 'active' | 'probation' | 'terminated';
    performance: {
      id: string;
      evaluationDate: Date;
      kpis: {
        taskCompletionRate: number;
        codeQuality: number;
        collaboration: number;
        innovation: number;
        efficiency: number;
      };
      tokenConsumption: {
        total: number;
        cost: number;
      };
      completedTasks: number;
      earnings: number;
      notes: string;
      evaluator: string;
    }[];
    salary: number;
    stockOptions: number;
    totalShares: number;
    lastEvaluationDate?: Date;
    terminationReason?: string;
  }[];

  @Prop({ type: [{
    id: String,
    name: String,
    description: String,
    managerId: String,
    budget: Number,
    employees: [String],
    kpis: {
      productivity: Number,
      quality: Number,
      innovation: Number
    }
  }] })
  departments: {
    id: string;
    name: string;
    description: string;
    managerId?: string;
    budget: number;
    employees: string[];
    kpis: {
      productivity: number;
      quality: number;
      innovation: number;
    };
  }[];

  @Prop({ type: Object })
  settings: {
    votingRules: {
      requiredQuorum: number;
      requiredApproval: number;
      votingPeriod: number;
    };
    performanceThresholds: {
      probationPeriod: number;
      minPerformanceScore: number;
      maxTokenConsumption: number;
    };
    recruitment: {
      maxNewHiresPerMonth: number;
      requireBoardApproval: boolean;
      probationPeriod: number;
    };
  };

  @Prop({ default: 1000000 }) // 初始估值100万
  valuation: number;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);