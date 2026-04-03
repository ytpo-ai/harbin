import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { 
  MeetingService, 
  CreateMeetingDto, 
  MeetingMessageDto,
  ControlMeetingMessageDto,
  ParticipantIdentity,
  MeetingSpeakingMode,
  SaveMeetingSummaryDto,
} from './meeting.service';
import { MeetingType, MeetingStatus } from '../../shared/schemas/meeting.schema';

@Controller('meetings')
export class MeetingController {
  constructor(private readonly meetingService: MeetingService) {}

  @Post()
  async createMeeting(@Body() dto: CreateMeetingDto) {
    const meeting = await this.meetingService.createMeeting(dto);
    return {
      success: true,
      data: meeting,
      message: '会议创建成功',
    };
  }

  @Get()
  async getAllMeetings(
    @Query('type') type?: MeetingType,
    @Query('status') status?: MeetingStatus,
    @Query('projectId') projectId?: string,
  ) {
    const meetings = await this.meetingService.getAllMeetings({ type, status, projectId });
    return {
      success: true,
      data: meetings,
    };
  }

  @Get('stats')
  async getMeetingStats() {
    const stats = await this.meetingService.getMeetingStats();
    return {
      success: true,
      data: stats,
    };
  }

  @Get('by-participant/:participantId')
  async getMeetingsByParticipant(
    @Param('participantId') participantId: string,
    @Query('type') type: 'employee' | 'agent' = 'employee',
  ) {
    const meetings = await this.meetingService.getMeetingsByParticipant(participantId, type);
    return {
      success: true,
      data: meetings,
    };
  }

  @Get(':id/agent-states')
  async getMeetingAgentStates(@Param('id') id: string) {
    const states = await this.meetingService.getMeetingAgentStates(id);
    return {
      success: true,
      data: states,
    };
  }

  @Get(':id')
  async getMeeting(@Param('id') id: string) {
    const meeting = await this.meetingService.getMeeting(id);
    if (!meeting) {
      return {
        success: false,
        message: '会议不存在',
      };
    }
    return {
      success: true,
      data: meeting,
    };
  }

  @Get(':id/detail')
  async getMeetingDetail(@Param('id') id: string) {
    const meeting = await this.meetingService.getMeetingDetail(id);
    if (!meeting) {
      return {
        success: false,
        message: '会议不存在',
      };
    }
    return {
      success: true,
      data: meeting,
    };
  }

  @Post(':id/start')
  async startMeeting(
    @Param('id') id: string,
    @Body() startedBy: ParticipantIdentity,
  ) {
    const meeting = await this.meetingService.startMeeting(id, startedBy);
    return {
      success: true,
      data: meeting,
      message: '会议已开始',
    };
  }

  @Post(':id/end')
  async endMeeting(@Param('id') id: string) {
    const meeting = await this.meetingService.endMeeting(id);
    return {
      success: true,
      data: meeting,
      message: '会议已结束',
    };
  }

  @Post(':id/generate-summary')
  async generateSummary(
    @Param('id') id: string,
    @Body() payload: SaveMeetingSummaryDto,
  ) {
    const result = await this.meetingService.generateMeetingSummary(id, payload);

    return {
      success: true,
      data: result,
      message: result.generated ? '会议总结已写入' : '会议总结无需重复写入',
    };
  }

  @Put(':id/summary')
  async saveSummary(
    @Param('id') id: string,
    @Body() payload: SaveMeetingSummaryDto,
  ) {
    const result = await this.meetingService.generateMeetingSummary(id, payload);

    return {
      success: true,
      data: result,
      message: result.generated ? '会议总结已写入' : '会议总结无需重复写入',
    };
  }

  @Post(':id/pause')
  async pauseMeeting(@Param('id') id: string) {
    const meeting = await this.meetingService.pauseMeeting(id);
    return {
      success: true,
      data: meeting,
      message: '会议已暂停',
    };
  }

  @Post(':id/resume')
  async resumeMeeting(@Param('id') id: string) {
    const meeting = await this.meetingService.resumeMeeting(id);
    return {
      success: true,
      data: meeting,
      message: '会议已恢复',
    };
  }

  @Put(':id/speaking-mode')
  async updateSpeakingMode(
    @Param('id') id: string,
    @Body('speakingOrder') speakingOrder: MeetingSpeakingMode,
  ) {
    const meeting = await this.meetingService.updateSpeakingMode(id, speakingOrder);
    return {
      success: true,
      data: meeting,
      message: '会议发言模式已更新',
    };
  }

  @Put(':id/title')
  async updateMeetingTitle(
    @Param('id') id: string,
    @Body('title') title: string,
  ) {
    const meeting = await this.meetingService.updateMeetingTitle(id, title);
    return {
      success: true,
      data: meeting,
      message: '会议名称已更新',
    };
  }

  @Post(':id/join')
  async joinMeeting(
    @Param('id') id: string,
    @Body() participant: ParticipantIdentity,
  ) {
    const meeting = await this.meetingService.joinMeeting(id, participant);
    return {
      success: true,
      data: meeting,
      message: '已成功加入会议',
    };
  }

  @Post(':id/leave')
  async leaveMeeting(
    @Param('id') id: string,
    @Body() participant: ParticipantIdentity,
  ) {
    const meeting = await this.meetingService.leaveMeeting(id, participant);
    return {
      success: true,
      data: meeting,
      message: '已离开会议',
    };
  }

  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() dto: MeetingMessageDto,
  ) {
    const message = await this.meetingService.sendMessage(id, dto);
    return {
      success: true,
      data: message,
      message: '消息已发送',
    };
  }

  @Post(':id/messages/:messageId/pause')
  async pauseMessageResponse(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: ControlMeetingMessageDto,
  ) {
    const message = await this.meetingService.pauseMessageResponse(id, messageId, dto.employeeId);
    return {
      success: true,
      data: message,
      message: '消息回复已暂停',
    };
  }

  @Post(':id/messages/:messageId/revoke')
  async revokePausedMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: ControlMeetingMessageDto,
  ) {
    const meeting = await this.meetingService.revokePausedMessage(id, messageId, dto.employeeId);
    return {
      success: true,
      data: meeting,
      message: '消息已撤回',
    };
  }

  @Post(':id/archive')
  async archiveMeeting(@Param('id') id: string) {
    const meeting = await this.meetingService.archiveMeeting(id);
    return {
      success: true,
      data: meeting,
      message: '会议已归档',
    };
  }

  @Delete(':id')
  async deleteMeeting(@Param('id') id: string) {
    await this.meetingService.deleteMeeting(id);
    return {
      success: true,
      message: '会议已删除',
    };
  }

  @Post(':id/invite')
  async inviteParticipant(
    @Param('id') id: string,
    @Body('participant') participant: ParticipantIdentity,
    @Body('invitedBy') invitedBy: ParticipantIdentity,
  ) {
    const meeting = await this.meetingService.inviteParticipant(id, participant, invitedBy);
    return {
      success: true,
      data: meeting,
      message: '邀请已发送',
    };
  }

  @Post(':id/participants')
  async addParticipant(
    @Param('id') id: string,
    @Body() participant: ParticipantIdentity,
  ) {
    const meeting = await this.meetingService.addParticipant(id, participant);
    return {
      success: true,
      data: meeting,
      message: '参会人员已添加',
    };
  }

  @Delete(':id/participants/:participantType/:participantId')
  async removeParticipant(
    @Param('id') id: string,
    @Param('participantType') participantType: 'employee' | 'agent',
    @Param('participantId') participantId: string,
  ) {
    const meeting = await this.meetingService.removeParticipant(id, participantId, participantType);
    return {
      success: true,
      data: meeting,
      message: '参会人员已移除',
    };
  }
}
