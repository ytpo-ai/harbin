import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { 
  MeetingService, 
  CreateMeetingDto, 
  MeetingMessageDto,
  ParticipantIdentity,
  MeetingEvent 
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
  ) {
    const meetings = await this.meetingService.getAllMeetings({ type, status });
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
}
