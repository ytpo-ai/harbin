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

export const useMeetingQueries = ({ effectiveMeetingId, selectedMeeting }: Params) => {
  const { data: currentUser } = useQuery('meeting-current-user', () => authService.getCurrentUser());
  const { data: meetings, isLoading: meetingsLoading } = useQuery('meetings', () => meetingService.getAllMeetings(), {
    refetchOnMount: 'always',
  });
  const { data: stats } = useQuery('meeting-stats', meetingService.getMeetingStats);
  const { data: agents } = useQuery('agents', agentService.getAgents);
  const { data: employees } = useQuery('employees', () => employeeService.getEmployees());

  const currentEmployee = useMemo(() => {
    if (!currentUser?.id || !employees) {
      return null;
    }
    const employeeList = employees as Employee[];
    const normalizedEmail = String(currentUser?.email || '')
      .trim()
      .toLowerCase();
    return (
      employeeList.find((employee) => employee.id === currentUser.id) ||
      employeeList.find((employee) => employee.userId === currentUser.id) ||
      employeeList.find(
        (employee) => normalizedEmail && String(employee.email || '').trim().toLowerCase() === normalizedEmail,
      ) ||
      null
    );
  }, [currentUser?.email, currentUser?.id, employees]);

  const hasExclusiveAssistant = Boolean(currentEmployee?.exclusiveAssistantAgentId || currentEmployee?.aiProxyAgentId);
  const currentExclusiveAssistantName = useMemo(() => {
    const assistantAgentId = currentEmployee?.exclusiveAssistantAgentId || currentEmployee?.aiProxyAgentId;
    if (!assistantAgentId) {
      return '';
    }

    const assistant = (agents || []).find((agent) => agent.id === assistantAgentId);
    return assistant?.name || '专属助理';
  }, [agents, currentEmployee?.aiProxyAgentId, currentEmployee?.exclusiveAssistantAgentId]);

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

  const participantDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    (agents || []).forEach((agent) => {
      if (agent.id) {
        map.set(`agent:${agent.id}`, agent.name);
      }
    });
    (employees || []).forEach((employee: Employee) => {
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
  }, [agents, currentUser, employees]);

  const managementCandidates = useMemo(() => {
    if (!selectedMeeting) {
      return [] as Array<{ key: string; id: string; type: 'employee' | 'agent'; name: string }>;
    }

    const participantKeys = new Set(
      (selectedMeeting.participants || []).map((participant) => `${participant.participantType}:${participant.participantId}`),
    );

    const candidates: Array<{ key: string; id: string; type: 'employee' | 'agent'; name: string }> = [];

    (employees || []).forEach((employee: Employee) => {
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

    (agents || [])
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
  }, [agents, employees, selectedMeeting]);

  return {
    currentUser,
    meetings: meetings || [],
    meetingsLoading,
    stats,
    agents: agents || [],
    employees: (employees || []) as Employee[],
    currentEmployee,
    hasExclusiveAssistant,
    currentExclusiveAssistantName,
    targetMeeting,
    meetingAgentStates: meetingAgentStates || [],
    participantDisplayMap,
    managementCandidates,
  };
};
