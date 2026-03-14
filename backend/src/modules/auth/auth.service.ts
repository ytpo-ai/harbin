import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee, EmployeeDocument, EmployeeType, EmployeeStatus } from '../../shared/schemas/employee.schema';
import { InvitationService } from '../invitations/invitation.service';
import * as crypto from 'crypto';
import {
  hashPassword as hashPasswordValue,
  verifyPassword as verifyPasswordValue,
} from '../../shared/utils/password.util';

function createToken(payload: any, secret: string, expiresIn: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadStr = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + (expiresIn === '7d' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000)
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payloadStr}`).digest('base64url');
  return `${header}.${payloadStr}.${signature}`;
}

function verifyToken(token: string, secret: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    if (signature !== expectedSig) return null;
    const payloadObj = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (payloadObj.exp < Date.now()) return null;
    return payloadObj;
  } catch {
    return null;
  }
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResponse {
  employee: {
    id: string;
    name: string;
    email: string;
    type: string;
    role: string;
  };
  token: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
  private readonly jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

  constructor(
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    private readonly invitationService: InvitationService,
  ) {}

  /**
   * 员工登录
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    const employee = await this.employeeModel.findOne({
      email: dto.email.toLowerCase(),
      type: EmployeeType.HUMAN,
    }).exec();

    if (!employee) {
      throw new NotFoundException('邮箱或密码错误');
    }

    if (!employee.passwordHash) {
      throw new BadRequestException('请通过邀请链接设置密码');
    }

    // 验证密码
    const isValid = await this.verifyPassword(dto.password, employee.passwordHash);
    if (!isValid) {
      throw new BadRequestException('邮箱或密码错误');
    }

    if (employee.status === EmployeeStatus.TERMINATED) {
      throw new BadRequestException('账户已被终止');
    }

    if (employee.status === EmployeeStatus.SUSPENDED) {
      throw new BadRequestException('账户已被暂停');
    }

    // 生成Token
    const token = this.generateToken(employee);

    this.logger.log(`Employee ${employee.name} logged in`);

    return {
      employee: {
        id: employee.id,
        name: employee.name || '',
        email: employee.email || '',
        type: employee.type,
        role: employee.role,
      },
      token,
    };
  }

  /**
   * 验证Token
   */
  async verifyToken(token: string): Promise<EmployeeDocument | null> {
    try {
      const decoded = verifyToken(token, this.jwtSecret) as { employeeId: string };
      if (!decoded) return null;
      const employee = await this.employeeModel.findOne({ id: decoded.employeeId }).exec();
      return employee;
    } catch (error) {
      return null;
    }
  }

  /**
   * 从Token获取员工信息
   */
  async getEmployeeFromToken(token: string): Promise<{
    id: string;
    name: string;
    email: string;
    type: string;
    role: string;
  } | null> {
    const decoded = verifyToken(token, this.jwtSecret) as { employeeId: string; email: string } | null;
    if (!decoded) return null;

    return {
      id: decoded.employeeId,
      name: '',
      email: decoded.email,
      type: EmployeeType.HUMAN,
      role: '',
    };
  }

  /**
   * 刷新Token
   */
  async refreshToken(oldToken: string): Promise<string> {
    const decoded = verifyToken(oldToken, this.jwtSecret) as any;
    if (!decoded) {
      throw new BadRequestException('无效的Token');
    }
    return this.generateTokenFromData(decoded);
  }

  private generateTokenFromData(data: any): string {
    return createToken({
      employeeId: data.employeeId,
      email: data.email,
    }, this.jwtSecret, this.jwtExpiresIn);
  }

  /**
   * 修改密码
   */
  async changePassword(
    employeeId: string, 
    oldPassword: string, 
    newPassword: string
  ): Promise<void> {
    const employee = await this.employeeModel.findOne({ id: employeeId }).exec();
    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    if (employee.passwordHash) {
      // 验证旧密码
      const isValid = await this.verifyPassword(oldPassword, employee.passwordHash);
      if (!isValid) {
        throw new BadRequestException('原密码错误');
      }
    }

    employee.passwordHash = await this.hashPassword(newPassword);
    await employee.save();

    this.logger.log(`Password changed for employee ${employeeId}`);
  }

  /**
   * 重置密码（通过邀请）
   */
  async resetPasswordViaInvite(
    code: string,
    linkToken: string,
    newPassword: string
  ): Promise<void> {
    const employee = await this.employeeModel.findOne({
      email: (await this.invitationService.getByCode(code))?.email,
    }).exec();

    if (!employee) {
      throw new NotFoundException('员工不存在');
    }

    employee.passwordHash = await this.hashPassword(newPassword);
    await employee.save();

    this.logger.log(`Password reset for employee ${employee.id}`);
  }

  // ===== 私有方法 =====

  private generateToken(employee: EmployeeDocument): string {
    return createToken(
      { 
        employeeId: employee.id,
        email: employee.email,
      },
      this.jwtSecret,
      this.jwtExpiresIn
    );
  }

  private hashPassword(password: string): string {
    return hashPasswordValue(password);
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    return verifyPasswordValue(password, storedHash);
  }
}
