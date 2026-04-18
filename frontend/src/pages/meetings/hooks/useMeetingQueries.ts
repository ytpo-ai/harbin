import { useMemo } from 'react';
import { useQuery } from 'react-query';
import { agentService } from '../../../services/agentService';
import { authService } from '../../../services/authService';
import { Employee, employeeService } from '../../../services/employeeService';
import { Meeting, MeetingStatus, meetingService } from '../../../services/meetingService';

type Params = {
  effectiveMeetingId: string | null;
  selectedMeeting: Meeting | null;
};

const normalizeArrayPayload = <T>(payload: unknown): T[] => {
  let current = payload;

  for (let i = 0; i < 4; i += 1) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      break;
    }

    const obj = current as Record<string, unknown>;
    const hasData = Object.prototype.hasOwnProperty.call(obj, 'data');
    if (!hasData) {
      break;
    }

    const isEnvelope =
      Object.prototype.hasOwnProperty.call(obj, 'success') ||
      Object.prototype.hasOwnProperty.call(obj, 'code') ||
      Object.prototype.hasOwnProperty.call(obj, 'message');

    if (!isEnvelope) {
      break;
    }

    current = obj.data;
  }

  if (Array.isArray(current)) {
    return current as T[];
  }

  if (!current || typeof current !== 'object') {
    return [];
  }

  const obj = current as Record<string, unknown>;
  const candidateKeys = ['items', 'list', 'rows', 'records', 'result', 'data'] as const;

  for (const key of candidateKeys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }

  return [];
};

export const useMeetingQueries = ({ effectiveMeetingId, selectedMeeting }: Params) => {
  const { data: currentUser } = useQuery('meeting-current-user', () => authService.getCurrentUser());
  const { data: meetings, isLoading: meetingsLoading } = useQuery('meetings', () => meetingService.getAllMeetings(), {
    refetchOnMount: 'always',
  });
  const { data: stats } = useQuery('meeting-stats', meetingService.getMeetingStats);
  const { data: agents } = useQuery('agents', () => agentService.getAgents());
  const { data: employees } = useQuery('employees', () => employeeService.getEmployees());

  const normalizedMeetings = useMemo(() => normalizeArrayPayload<Meeting>(meetings), [meetings]);
  const normalizedAgents = useMemo(() => agentService.normalizeAgentList(agents), [agents]);
  const normalizedEmployees = useMemo(() => normalizeArrayPayload<Employee>(employees), [employees]);

  const currentEmployee = useMemo(() => {
    if (!currentUser?.id || normalizedEmployees.length === 0) {
      return null;
    }
    const normalizedEmail = String(currentUser?.email || '')
      .trim()
      .toLowerCase();
    return (
      normalizedEmployees.find((employee) => employee.id === currentUser.id) ||
      normalizedEmployees.find((employee) => employee.userId === currentUser.id) ||
      normalizedEmployees.find(
        (employee) => normalizedEmail && String(employee.email || '').trim().toLowerCase() === normalizedEmail,
      ) ||
      null
    );
  }, [currentUser?.email, currentUser?.id, normalizedEmployees]);

  const { data: targetMeeting } = useQuery(['meeting', effectiveMeetingId], () => meetingService.getMeeting(effectiveMeetingId as string), {
    enabled: Boolean(effectiveMeetingId),
    staleTime: 0,
    retry: 1,
  });

  const { data: meetingAgentStates } = useQuery(
    ['meeting-agent-states', selectedMeeting?.id],
    () => meetingService.getMeetingAgentStates(selectedMeeting!.id),
    {
      enabled: Boolean(selectedMeeting?.id && selectedMeeting.status === MeetingStatus.ACTIVE),
      refetchInterval: 5000,
    },
  );

  const normalizedMeetingAgentStates = useMemo(
    () => normalizeArrayPayload<{ agentId: string; state: 'thinking' | 'idle'; updatedAt: string; reason?: string }>(meetingAgentStates),
    [meetingAgentStates],
  );

  const participantDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    normalizedAgents.forEach((agent) => {
      if (agent.id) {
        map.set(`agent:${agent.id}`, agent.name);
      }
    });
    normalizedEmployees.forEach((employee) => {
      if (employee.id) {
        map.set(`employee:${employee.id}`, employee.name || employee.email || employee.id);
      }
      if (employee.agentId) {
        map.set(`agent:${employee.agentId}`, employee.name || employee.agentId);
      }
    });
    if (currentUser?.id) {
      map.set(`employee:${currentUser.id}`, currentUser.name || currentUser.email || currentUser.id);
    }
    return map;
  }, [currentUser, normalizedAgents, normalizedEmployees]);

  const managementCandidates = useMemo(() => {
    if (!selectedMeeting) {
      return [] as Array<{ key: string; id: string; type: 'employee' | 'agent'; name: string }>;
    }

    const participantKeys = new Set(
      (selectedMeeting.participants || []).map((participant) => `${participant.participantType}:${participant.participantId}`),
    );

    const candidates: Array<{ key: string; id: string; type: 'employee' | 'agent'; name: string }> = [];

    normalizedEmployees.forEach((employee) => {
      if (!employee.id) {
        return;
      }
      const key = `employee:${employee.id}`;
      if (!participantKeys.has(key)) {
        candidates.push({
          key,
          id: employee.id,
          type: 'employee',
          name: employee.name || employee.email || employee.id,
        });
      }
    });

    normalizedAgents
      .filter((agent) => agent.id && agent.isActive)
      .forEach((agent) => {
        const key = `agent:${agent.id}`;
        if (!participantKeys.has(key)) {
          candidates.push({
            key,
            id: agent.id!,
            type: 'agent',
            name: agent.name,
          });
        }
      });

    return candidates.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [normalizedAgents, normalizedEmployees, selectedMeeting]);

  return {
    currentUser,
    meetings: normalizedMeetings,
    meetingsLoading,
    stats,
    agents: normalizedAgents,
    employees: normalizedEmployees,
    currentEmployee,
    targetMeeting,
    meetingAgentStates: normalizedMeetingAgentStates,
    participantDisplayMap,
    managementCandidates,
  };
};
