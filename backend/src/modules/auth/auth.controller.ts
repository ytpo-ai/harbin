import { Controller, Get, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { AuthService, LoginDto, AuthResponse } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 员工登录
   */
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto);
  }

  /**
   * 验证Token
   */
  @Get('verify')
  async verify(@Headers('authorization') authHeader: string): Promise<any> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const employee = await this.authService.getEmployeeFromToken(token);

    if (!employee) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    return {
      valid: true,
      employee,
    };
  }

  /**
   * 刷新Token
   */
  @Post('refresh')
  async refresh(@Headers('authorization') authHeader: string): Promise<{ token: string }> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const newToken = await this.authService.refreshToken(token);

    return { token: newToken };
  }

  /**
   * 修改密码
   */
  @Post('change-password')
  async changePassword(
    @Headers('authorization') authHeader: string,
    @Body() body: { oldPassword: string; newPassword: string }
  ): Promise<{ success: boolean; message: string }> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const employee = await this.authService.getEmployeeFromToken(token);

    if (!employee) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    await this.authService.changePassword(
      employee.id,
      body.oldPassword,
      body.newPassword
    );

    return {
      success: true,
      message: '密码修改成功',
    };
  }

  /**
   * 获取当前用户信息
   */
  @Get('me')
  async getCurrentUser(@Headers('authorization') authHeader: string): Promise<any> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const employee = await this.authService.getEmployeeFromToken(token);

    if (!employee) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    return employee;
  }
}
