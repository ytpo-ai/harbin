import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invitation, InvitationDocument, InvitationStatus, InvitationRole } from '../../shared/schemas/invitation.schema';
import { Employee, EmployeeDocument, EmployeeType, EmployeeStatus, EmployeeRole } from '../../shared/schemas/employee.schema';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

export interface CreateInvitationDto {
  organizationId: string;
  invitedBy: string;
  invitedByName: string;
  role: InvitationRole;
  departmentId?: string;
  title?: string;
  email?: string;
  name?: string;
  message?: string;
  expiresInDays?: number;  // 默认7天
  maxUses?: number;      // 默认1次
}

export interface AcceptInvitationDto {
  code: string;
  linkToken: string;
  // 用户信息
  email: string;
  name: string;
  password: string;
}

export interface InvitationStats {
  total: number;
  pending: number;
  accepted: number;
  expired: number;
}

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @InjectModel(Invitation.name) private invitationModel: Model<InvitationDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
  ) {}

  /**
   * 创建邀请
   */
  async createInvitation(dto: CreateInvitationDto): Promise<Invitation> {
    // 生成短邀请码（6位）
    const code = this.generateShortCode();
    
    // 生成链接Token
    const linkToken = uuidv4();

    // 过期时间
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (dto.expiresInDays || 7));

    const invitation = new this.invitationModel({
      id: uuidv4(),
      organizationId: dto.organizationId,
      code,
      invitedBy: dto.invitedBy,
      invitedByName: dto.invitedByName,
      role: dto.role,
      departmentId: dto.departmentId,
      title: dto.title,
      email: dto.email,
      name: dto.name,
      message: dto.message,
      linkToken,
      expiresAt,
      status: InvitationStatus.PENDING,
      maxUses: dto.maxUses || 1,
      usedCount: 0,
    });

    const saved = await invitation.save();
    this.logger.log(`Created invitation: ${code} for org ${dto.organizationId}`);

    return saved;
  }

  /**
   * 通过邀请码获取邀请
   */
  async getByCode(code: string): Promise<Invitation | null> {
    return this.invitationModel.findOne({ code }).exec();
  }

  /**
   * 通过链接Token获取邀请
   */
  async getByLinkToken(linkToken: string): Promise<Invitation | null> {
    return this.invitationModel.findOne({ linkToken }).exec();
  }

  /**
   * 获取组织所有邀请
   */
  async getByOrganization(organizationId: string): Promise<Invitation[]> {
    return this.invitationModel.find({ organizationId })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * 获取组织的邀请统计
   */
  async getStats(organizationId: string): Promise<InvitationStats> {
    const total = await this.invitationModel.countDocuments({ organizationId });
    const pending = await this.invitationModel.countDocuments({ 
      organizationId, 
      status: InvitationStatus.PENDING 
    });
    const accepted = await this.invitationModel.countDocuments({ 
      organizationId, 
      status: InvitationStatus.ACCEPTED 
    });
    const expired = await this.invitationModel.countDocuments({ 
      organizationId, 
      status: InvitationStatus.EXPIRED 
    });

    return { total, pending, accepted, expired };
  }

  /**
   * 验证邀请（检查是否有效）
   */
  async validateInvitation(code: string, linkToken: string): Promise<{
    valid: boolean;
    invitation?: Invitation;
    error?: string;
  }> {
    const invitation = await this.getByCode(code);
    
    if (!invitation) {
      return { valid: false, error: '邀请码不存在' };
    }

    if (invitation.linkToken !== linkToken) {
      return { valid: false, error: '邀请链接无效' };
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      return { valid: false, error: `邀请已${invitation.status === InvitationStatus.ACCEPTED ? '被使用' : '失效'}` };
    }

    if (new Date() > invitation.expiresAt) {
      await this.invitationModel.updateOne(
        { id: invitation.id },
        { status: InvitationStatus.EXPIRED }
      );
      return { valid: false, error: '邀请已过期' };
    }

    if (invitation.usedCount >= invitation.maxUses) {
      return { valid: false, error: '邀请使用次数已用完' };
    }

    return { valid: true, invitation };
  }

  /**
   * 接受邀请（注册并加入组织）
   */
  async acceptInvitation(dto: AcceptInvitationDto): Promise<Employee> {
    // 验证邀请
    const validation = await this.validateInvitation(dto.code, dto.linkToken);
    if (!validation.valid || !validation.invitation) {
      throw new BadRequestException(validation.error);
    }

    const invitation = validation.invitation;

    // 检查邮箱是否匹配（如果指定了邮箱）
    if (invitation.email && invitation.email.toLowerCase() !== dto.email.toLowerCase()) {
      throw new BadRequestException('邮箱与邀请不匹配');
    }

    // 检查是否已经接受过
    const existingEmployee = await this.employeeModel.findOne({
      organizationId: invitation.organizationId,
      email: dto.email.toLowerCase(),
    }).exec();

    if (existingEmployee) {
      throw new ConflictException('该邮箱已是组织成员');
    }

    // 将邀请角色转换为员工角色
    const employeeRole = this.convertToEmployeeRole(invitation.role);

    // 创建员工账户
    const employee = new this.employeeModel({
      id: uuidv4(),
      organizationId: invitation.organizationId,
      type: EmployeeType.HUMAN,
      email: dto.email.toLowerCase(),
      name: dto.name,
      role: employeeRole,
      departmentId: invitation.departmentId,
      title: invitation.title,
      status: EmployeeStatus.PROBATION,
      joinDate: new Date(),
      passwordHash: this.hashPassword(dto.password),
      shares: 0,
      stockOptions: 0,
      salary: 0,
      capabilities: [],
      permissions: [],
      toolAccess: [],
      performance: {
        overallScore: 0,
        taskCompletionRate: 0,
        codeQuality: 0,
        collaboration: 0,
        innovation: 0,
        efficiency: 0,
        totalEvaluations: 0,
      },
      statistics: {
        totalTasks: 0,
        completedTasks: 0,
        totalTokens: 0,
        totalCost: 0,
        meetingsAttended: 0,
        meetingsHosted: 0,
      },
      meetingPreferences: {
        autoJoin: true,
        notifications: true,
        preferredMeetingTypes: [],
      },
    });

    const savedEmployee = await employee.save();

    // 更新邀请状态
    await this.invitationModel.updateOne(
      { id: invitation.id },
      {
        status: InvitationStatus.ACCEPTED,
        usedAt: new Date(),
        usedBy: savedEmployee.id,
        usedCount: invitation.usedCount + 1,
      }
    );

    this.logger.log(`Employee ${savedEmployee.name} joined via invitation ${invitation.code}`);

    return savedEmployee;
  }

  /**
   * 取消邀请
   */
  async cancelInvitation(invitationId: string): Promise<Invitation | null> {
    const invitation = await this.invitationModel.findOne({ id: invitationId }).exec();
    if (!invitation) return null;

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('只能取消待处理的邀请');
    }

    await this.invitationModel.updateOne(
      { id: invitationId },
      { status: InvitationStatus.CANCELLED }
    );

    this.logger.log(`Invitation ${invitation.code} cancelled`);
    return invitation;
  }

  /**
   * 重新发送邀请（重置过期时间）
   */
  async resendInvitation(invitationId: string, expiresInDays: number = 7): Promise<Invitation | null> {
    const invitation = await this.invitationModel.findOne({ id: invitationId }).exec();
    if (!invitation) return null;

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('只能重新发送待处理的邀请');
    }

    // 重置过期时间
    invitation.expiresAt = new Date();
    invitation.expiresAt.setDate(invitation.expiresAt.getDate() + expiresInDays);
    
    // 生成新的链接Token
    invitation.linkToken = uuidv4();
    
    await invitation.save();

    this.logger.log(`Invitation ${invitation.code} resent, expires at ${invitation.expiresAt}`);

    return invitation;
  }

  /**
   * 删除过期邀请
   */
  async deleteExpiredInvitations(organizationId: string): Promise<number> {
    const result = await this.invitationModel.deleteMany({
      organizationId,
      status: InvitationStatus.PENDING,
      expiresAt: { $lt: new Date() },
    }).exec();

    return result.deletedCount;
  }

  /**
   * 验证员工登录
   */
  async validateLogin(email: string, password: string): Promise<Employee | null> {
    const employee = await this.employeeModel.findOne({ 
      email: email.toLowerCase(),
      type: EmployeeType.HUMAN,
    }).exec();

    if (!employee) {
      return null;
    }

    if (!employee.passwordHash) {
      return null;
    }

    if (!this.verifyPassword(password, employee.passwordHash)) {
      return null;
    }

    if (employee.status === EmployeeStatus.TERMINATED) {
      throw new BadRequestException('账户已被终止');
    }

    return employee;
  }

  /**
   * 更新密码
   */
  async updatePassword(employeeId: string, newPassword: string): Promise<void> {
    const employee = await this.employeeModel.findOne({ id: employeeId }).exec();
    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    employee.passwordHash = this.hashPassword(newPassword);
    await employee.save();

    this.logger.log(`Password updated for employee ${employeeId}`);
  }

  /**
   * 生成邀请链接
   */
  getInvitationLink(code: string, linkToken: string, baseUrl: string = 'http://localhost:3000'): string {
    return `${baseUrl}/invite/${code}?token=${linkToken}`;
  }

  // ===== 私有方法 =====

  /**
   * 生成6位短邀请码
   */
  private generateShortCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除易混淆字符
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * 密码哈希
   */
  private hashPassword(password: string): string {
    const { hashPassword } = require('../../shared/utils/password.util');
    return hashPassword(password);
  }

  /**
   * 验证密码
   */
  private verifyPassword(password: string, storedHash: string): boolean {
    const { verifyPassword } = require('../../shared/utils/password.util');
    return verifyPassword(password, storedHash);
  }

  /**
   * 转换邀请角色为员工角色
   */
  private convertToEmployeeRole(invitationRole: InvitationRole): EmployeeRole {
    const mapping: Record<InvitationRole, EmployeeRole> = {
      [InvitationRole.FOUNDER]: EmployeeRole.FOUNDER,
      [InvitationRole.CO_FOUNDER]: EmployeeRole.CO_FOUNDER,
      [InvitationRole.MANAGER]: EmployeeRole.MANAGER,
      [InvitationRole.SENIOR]: EmployeeRole.SENIOR,
      [InvitationRole.JUNIOR]: EmployeeRole.JUNIOR,
      [InvitationRole.INTERN]: EmployeeRole.INTERN,
    };
    return mapping[invitationRole] || EmployeeRole.JUNIOR;
  }
}
