import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ChannelUserMapping,
  ChannelUserMappingDocument,
} from './schemas/channel-user-mapping.schema';
import { Employee, EmployeeDocument, EmployeeType } from '../../../../../src/shared/schemas/employee.schema';

export interface ResolvedChannelEmployee {
  employeeId: string;
  exclusiveAssistantAgentId?: string;
  role?: string;
  email?: string;
}

@Injectable()
export class ChannelUserMappingService {
  constructor(
    @InjectModel(ChannelUserMapping.name)
    private readonly mappingModel: Model<ChannelUserMappingDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  async resolveEmployee(providerType: 'feishu-app', externalUserId: string): Promise<ResolvedChannelEmployee | null> {
    const provider = String(providerType || '').trim() as 'feishu-app';
    const externalId = String(externalUserId || '').trim();
    if (!provider || !externalId) {
      return null;
    }

    const mapping = await this.mappingModel
      .findOne({
        providerType: provider,
        externalUserId: externalId,
        isActive: true,
      })
      .exec();

    if (!mapping) {
      return null;
    }

    const employee = await this.employeeModel
      .findOne({
        id: mapping.employeeId,
        type: EmployeeType.HUMAN,
      })
      .select({ id: 1, email: 1, role: 1, exclusiveAssistantAgentId: 1, aiProxyAgentId: 1 })
      .exec();

    if (!employee) {
      return null;
    }

    await this.mappingModel
      .updateOne(
        { _id: mapping._id },
        {
          $set: {
            lastActiveAt: new Date(),
          },
        },
      )
      .exec();

    return {
      employeeId: employee.id,
      exclusiveAssistantAgentId: employee.exclusiveAssistantAgentId || employee.aiProxyAgentId || undefined,
      role: employee.role,
      email: employee.email,
    };
  }

  async bindUser(input: {
    providerType: 'feishu-app';
    externalUserId: string;
    employeeId: string;
    displayName?: string;
  }) {
    const providerType = String(input.providerType || '').trim() as 'feishu-app';
    const externalUserId = String(input.externalUserId || '').trim();
    const employeeId = String(input.employeeId || '').trim();
    const displayName = String(input.displayName || '').trim() || undefined;

    if (!providerType || !externalUserId || !employeeId) {
      throw new BadRequestException('providerType/externalUserId/employeeId are required');
    }

    const employee = await this.employeeModel
      .findOne({
        id: employeeId,
        type: EmployeeType.HUMAN,
      })
      .select({ id: 1 })
      .exec();
    if (!employee) {
      throw new NotFoundException('employee not found');
    }

    const mapping = await this.mappingModel
      .findOneAndUpdate(
        { providerType, externalUserId },
        {
          $set: {
            employeeId,
            displayName,
            isActive: true,
            lastActiveAt: new Date(),
            boundAt: new Date(),
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      )
      .exec();

    return this.toResponse(mapping);
  }

  async bindByEmail(input: {
    providerType: 'feishu-app';
    externalUserId: string;
    email: string;
    displayName?: string;
  }) {
    const email = String(input.email || '').trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('email is required');
    }

    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const employee = await this.employeeModel
      .findOne({
        email: { $regex: `^${escapedEmail}$`, $options: 'i' },
        type: EmployeeType.HUMAN,
      })
      .select({ id: 1 })
      .exec();

    if (!employee) {
      throw new NotFoundException('employee not found by email');
    }

    return this.bindUser({
      providerType: input.providerType,
      externalUserId: input.externalUserId,
      employeeId: employee.id,
      displayName: input.displayName,
    });
  }

  async listMappings() {
    const rows = await this.mappingModel.find().sort({ updatedAt: -1 }).exec();
    return rows.map((item) => this.toResponse(item));
  }

  async unbindUser(id: string): Promise<{ success: true }> {
    const docId = String(id || '').trim();
    if (!docId) {
      throw new BadRequestException('id is required');
    }
    const deleted = await this.mappingModel.findOneAndDelete({ _id: docId }).exec();
    if (!deleted) {
      throw new NotFoundException('channel user mapping not found');
    }
    return { success: true };
  }

  private toResponse(doc: ChannelUserMappingDocument | null) {
    if (!doc) {
      return null;
    }
    return {
      id: doc._id.toString(),
      providerType: doc.providerType,
      externalUserId: doc.externalUserId,
      employeeId: doc.employeeId,
      displayName: doc.displayName,
      boundAt: doc.boundAt,
      lastActiveAt: doc.lastActiveAt,
      isActive: doc.isActive,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
