import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { MessageCenterService } from './message-center.service';
import { SystemMessageType } from '../../shared/schemas/system-message.schema';
import { InnerMessageMode, InnerMessageStatus } from '../../shared/schemas/inner-message.schema';

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

  @Get('inner-messages')
  async listInnerMessages(
    @Headers('authorization') authHeader: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('mode') mode?: InnerMessageMode,
    @Query('status') status?: InnerMessageStatus,
    @Query('eventType') eventType?: string,
  ) {
    const currentEmployee = await this.resolveCurrentEmployee(authHeader);

    return {
      success: true,
      data: await this.messageCenterService.listInnerMessages({
        receiverAgentId: currentEmployee.receiverAgentId || '',
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        mode,
        status,
        eventType,
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

  @Post('hooks/engineering-statistics')
  async createEngineeringStatisticsMessage(
    @Body()
    payload: {
      receiverId: string;
      snapshotId: string;
      status: 'success' | 'failed';
      title?: string;
      content?: string;
      summary?: Record<string, any>;
      error?: string;
    },
  ) {
    if (!payload?.receiverId || !payload?.snapshotId || !payload?.status) {
      throw new BadRequestException('receiverId, snapshotId and status are required');
    }

    const defaultTitle =
      payload.status === 'success'
        ? '工程统计执行完成'
        : '工程统计执行失败';
    const defaultContent =
      payload.status === 'success'
        ? `统计快照 ${payload.snapshotId} 已完成，可查看详情。`
        : `统计快照 ${payload.snapshotId} 执行失败，请检查错误信息。`;

    const message = await this.messageCenterService.createSystemMessage({
      receiverId: payload.receiverId,
      type: 'engineering_statistics',
      title: payload.title || defaultTitle,
      content: payload.content || defaultContent,
      payload: {
        snapshotId: payload.snapshotId,
        status: payload.status,
        summary: payload.summary || {},
        error: payload.error,
        redirectPath: `/ei/statistics?snapshotId=${encodeURIComponent(payload.snapshotId)}`,
      },
      source: 'engineering-intelligence',
    });

    return {
      success: true,
      data: message,
    };
  }
}
