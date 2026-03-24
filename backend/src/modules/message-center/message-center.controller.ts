import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { MessageCenterService } from './message-center.service';
import { SystemMessageType } from '../../shared/schemas/system-message.schema';

interface CurrentEmployeeContext {
  employeeId: string;
  receiverAgentId?: string;
}

@Controller('message-center')
export class MessageCenterController {
  constructor(
    private readonly authService: AuthService,
    private readonly messageCenterService: MessageCenterService,
  ) {}

  private async resolveCurrentEmployee(authHeader: string): Promise<CurrentEmployeeContext> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const employee = await this.authService.verifyToken(token);
    if (!employee?.id) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    const receiverAgentId = String(employee.exclusiveAssistantAgentId || employee.aiProxyAgentId || '').trim() || undefined;

    return {
      employeeId: employee.id,
      receiverAgentId,
    };
  }

  @Get('messages')
  async listMessages(
    @Headers('authorization') authHeader: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('isRead') isRead?: string,
    @Query('type') type?: SystemMessageType,
  ) {
    const currentEmployee = await this.resolveCurrentEmployee(authHeader);

    const normalizedIsRead =
      typeof isRead === 'string'
        ? isRead.toLowerCase() === 'true'
          ? true
          : isRead.toLowerCase() === 'false'
            ? false
            : undefined
        : undefined;

    return {
      success: true,
      data: await this.messageCenterService.listMessages({
        receiverId: currentEmployee.employeeId,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        isRead: normalizedIsRead,
        type,
      }),
    };
  }

  @Get('unread-count')
  async getUnreadCount(@Headers('authorization') authHeader: string) {
    const currentEmployee = await this.resolveCurrentEmployee(authHeader);
    const unreadCount = await this.messageCenterService.getUnreadCount(currentEmployee.employeeId);

    return {
      success: true,
      data: {
        unreadCount,
      },
    };
  }

  @Patch('messages/:messageId/read')
  async markAsRead(
    @Headers('authorization') authHeader: string,
    @Param('messageId') messageId: string,
  ) {
    if (!messageId?.trim()) {
      throw new BadRequestException('messageId is required');
    }

    const currentEmployee = await this.resolveCurrentEmployee(authHeader);

    return {
      success: true,
      data: await this.messageCenterService.markAsRead(currentEmployee.employeeId, messageId),
    };
  }

  @Patch('messages/read-all')
  async markAllAsRead(@Headers('authorization') authHeader: string) {
    const currentEmployee = await this.resolveCurrentEmployee(authHeader);

    return {
      success: true,
      data: await this.messageCenterService.markAllAsRead(currentEmployee.employeeId),
    };
  }

}
