import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeService } from '../../employees/employee.service';
import { EmployeeType } from '../../../shared/schemas/employee.schema';
import { MeetingDocument, ParticipantRole } from '../../../shared/schemas/meeting.schema';
import { MeetingParticipantRecord } from '../meeting.types';

@Injectable()
export class MeetingParticipantHelperService {
  constructor(private readonly employeeService: EmployeeService) {}

  private async getEmployeeOrThrow(employeeId: string) {
    const employee = await this.employeeService.getEmployee(employeeId);
    if (!employee) {
      throw new NotFoundException(`Employee not found: ${employeeId}`);
    }
    return employee;
  }

  async getRequiredExclusiveAssistantAgentId(employeeId: string): Promise<string> {
    const employee = await this.getEmployeeOrThrow(employeeId);

    if (employee.type !== EmployeeType.HUMAN) {
      throw new ConflictException('Only human accounts can initiate or join meetings in employee mode');
    }

    const assistantAgentId = employee.exclusiveAssistantAgentId || employee.aiProxyAgentId;
    if (!assistantAgentId) {
      throw new ConflictException('Human account must bind an exclusive assistant before initiating or joining meetings');
    }

    return assistantAgentId;
  }

  upsertExclusiveAssistantParticipant(
    meeting: MeetingDocument,
    ownerEmployeeId: string,
    assistantAgentId: string,
    isPresent: boolean,
  ): void {
    const now = new Date();
    const existing = meeting.participants.find(
      (p) => p.participantId === assistantAgentId && p.participantType === 'agent',
    ) as MeetingParticipantRecord | undefined;

    if (existing) {
      existing.isExclusiveAssistant = true;
      existing.assistantForEmployeeId = ownerEmployeeId;
      if (isPresent) {
        existing.isPresent = true;
        existing.joinedAt = existing.joinedAt || now;
      }
      return;
    }

    meeting.participants.push({
      participantId: assistantAgentId,
      participantType: 'agent',
      role: ParticipantRole.PARTICIPANT,
      isPresent,
      hasSpoken: false,
      messageCount: 0,
      joinedAt: isPresent ? now : undefined,
      isExclusiveAssistant: true,
      assistantForEmployeeId: ownerEmployeeId,
    });
  }
}
