import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useSearchParams, useParams } from 'react-router-dom';
import { meetingService, Meeting, MeetingType, MeetingStatus, CreateMeetingDto, MeetingSpeakingMode, ParticipantRole } from '../services/meetingService';
import { agentService } from '../services/agentService';
import { authService } from '../services/authService';
import { employeeService, Employee } from '../services/employeeService';
import { wsService } from '../services/wsService';
import { Agent } from '../types';
import { 
  VideoCameraIcon,
  PlusIcon,
  PlayIcon,
  PauseIcon,
  StopIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  CheckCircleIcon,
  PaperAirplaneIcon,
  UserPlusIcon,
  XMarkIcon,
  ArchiveBoxIcon,
  TrashIcon,
  ArrowTopRightOnSquareIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';

const MEETING_TYPES = [
  { id: MeetingType.WEEKLY, name: '周会', color: 'bg-blue-100 text-blue-800', icon: '📅' },
  { id: MeetingType.BOARD, name: '董事会', color: 'bg-purple-100 text-purple-800', icon: '👔' },
  { id: MeetingType.DAILY, name: '日常讨论', color: 'bg-green-100 text-green-800', icon: '💬' },
  { id: MeetingType.DEPARTMENT, name: '部门会议', color: 'bg-yellow-100 text-yellow-800', icon: '🏢' },
  { id: MeetingType.AD_HOC, name: '临时会议', color: 'bg-gray-100 text-gray-800', icon: '⚡' },
  { id: MeetingType.PROJECT, name: '项目会议', color: 'bg-indigo-100 text-indigo-800', icon: '📊' },
  { id: MeetingType.EMERGENCY, name: '紧急会议', color: 'bg-red-100 text-red-800', icon: '🚨' },
];

interface MeetingRealtimeEvent {
  type: 'message' | 'participant_joined' | 'participant_left' | 'status_changed' | 'typing' | 'summary_generated' | 'settings_changed';
  meetingId: string;
  data: any;
  timestamp: string;
}

interface MentionCandidate {
  id: string;
  type: 'employee' | 'agent';
  name: string;
}

const Meetings: React.FC = () => {
  const queryClient = useQueryClient();
  const { meetingId: meetingIdFromPath } = useParams<{ meetingId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [selectedCandidateKey, setSelectedCandidateKey] = useState('');
  const [isOperationsCollapsed, setIsOperationsCollapsed] = useState(false);
  const [pinnedMeetingId, setPinnedMeetingId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const isChatOnlyMode = Boolean(meetingIdFromPath);

  useEffect(() => {
    authService.getCurrentUser().then(setCurrentUser);
  }, []);

  const { data: meetings, isLoading: meetingsLoading } = useQuery('meetings', () => 
    meetingService.getAllMeetings(),
    {
      refetchOnMount: 'always',
    },
  );
  const { data: stats } = useQuery('meeting-stats', meetingService.getMeetingStats);
  const { data: agents } = useQuery('agents', agentService.getAgents);
  const { data: employees } = useQuery('employees', () => employeeService.getEmployees());
  const targetMeetingId = meetingIdFromPath || searchParams.get('meetingId');
  const effectiveMeetingId = pinnedMeetingId || targetMeetingId;
  const { data: targetMeeting } = useQuery(
    ['meeting', effectiveMeetingId],
    () => meetingService.getMeeting(effectiveMeetingId as string),
    {
      enabled: Boolean(effectiveMeetingId),
      staleTime: 0,
      retry: 1,
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

  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (!selectedMeeting) {
      return [];
    }

    const unique = new Map<string, MentionCandidate>();
    (selectedMeeting.participants || []).forEach((participant) => {
      const key = `${participant.participantType}:${participant.participantId}`;
      const name = participantDisplayMap.get(key) || participant.participantId;
      unique.set(key, {
        id: participant.participantId,
        type: participant.participantType,
        name,
      });
    });
    return Array.from(unique.values());
  }, [participantDisplayMap, selectedMeeting]);

  const filteredMentionCandidates = useMemo(() => {
    if (mentionStart === null) {
      return [];
    }

    const normalizedQuery = mentionQuery.trim().toLowerCase();
    return mentionCandidates.filter((candidate) => {
      if (!normalizedQuery) {
        return true;
      }
      return candidate.name.toLowerCase().includes(normalizedQuery) || candidate.id.toLowerCase().includes(normalizedQuery);
    });
  }, [mentionCandidates, mentionQuery, mentionStart]);

  const managementCandidates = useMemo(() => {
    if (!selectedMeeting) {
      return [];
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

  useEffect(() => {
    if (!targetMeetingId) {
      return;
    }
    setPinnedMeetingId(targetMeetingId);
  }, [targetMeetingId]);

  useEffect(() => {
    const meetingId = effectiveMeetingId;
    if (!meetingId || !meetings || meetings.length === 0) {
      return;
    }

    if (selectedMeeting?.id === meetingId) {
      return;
    }

    const matchedMeeting = meetings.find((meeting) => meeting.id === meetingId);
    if (matchedMeeting) {
      setSelectedMeeting(matchedMeeting);
      return;
    }
    setSelectedMeeting(null);
  }, [effectiveMeetingId, meetings, selectedMeeting?.id]);

  useEffect(() => {
    if (!effectiveMeetingId || !targetMeeting) {
      return;
    }

    if (selectedMeeting?.id === targetMeeting.id) {
      return;
    }

    setSelectedMeeting(targetMeeting);
  }, [effectiveMeetingId, selectedMeeting?.id, targetMeeting]);

  useEffect(() => {
    setTitleDraft(selectedMeeting?.title || '');
  }, [selectedMeeting?.id, selectedMeeting?.title]);

  useEffect(() => {
    if (!selectedCandidateKey && managementCandidates.length > 0) {
      setSelectedCandidateKey(managementCandidates[0].key);
      return;
    }

    if (selectedCandidateKey && !managementCandidates.some((candidate) => candidate.key === selectedCandidateKey)) {
      setSelectedCandidateKey(managementCandidates[0]?.key || '');
    }
  }, [managementCandidates, selectedCandidateKey]);

  useEffect(() => {
    if (mentionStart === null) {
      return;
    }
    if (filteredMentionCandidates.length === 0) {
      setMentionActiveIndex(0);
      return;
    }
    if (mentionActiveIndex >= filteredMentionCandidates.length) {
      setMentionActiveIndex(0);
    }
  }, [filteredMentionCandidates.length, mentionActiveIndex, mentionStart]);

  useEffect(() => {
    setIsOperationsCollapsed(isChatOnlyMode);
  }, [isChatOnlyMode]);
  
  const createMutation = useMutation(meetingService.createMeeting, {
    onSuccess: (data) => {
      queryClient.invalidateQueries('meetings');
      queryClient.invalidateQueries('meeting-stats');
      setIsCreateModalOpen(false);
      setSelectedMeeting(data);
    },
  });

  const startMutation = useMutation(
    ({ id, startedById, startedByType, startedByName }: { id: string; startedById: string; startedByType: 'employee' | 'agent'; startedByName: string }) => 
      meetingService.startMeeting(id, { id: startedById, type: startedByType, name: startedByName, isHuman: startedByType === 'employee' }),
    {
      onSuccess: (data) => {
        setSelectedMeeting(data);
        // Then invalidate to refresh in background
        setTimeout(() => {
          queryClient.invalidateQueries('meetings');
        }, 500);
      },
    }
  );

  const endMutation = useMutation(meetingService.endMeeting, {
    onSuccess: (data) => {
      setSelectedMeeting(data);
      queryClient.invalidateQueries('meetings');
      queryClient.invalidateQueries('meeting-stats');
    },
  });

  const pauseMutation = useMutation(meetingService.pauseMeeting, {
    onSuccess: (data) => {
      setSelectedMeeting(data);
      queryClient.invalidateQueries('meetings');
      queryClient.invalidateQueries('meeting-stats');
    },
  });

  const resumeMutation = useMutation(meetingService.resumeMeeting, {
    onSuccess: (data) => {
      setSelectedMeeting(data);
      queryClient.invalidateQueries('meetings');
      queryClient.invalidateQueries('meeting-stats');
    },
  });

  const speakingModeMutation = useMutation(
    ({ id, speakingOrder }: { id: string; speakingOrder: MeetingSpeakingMode }) =>
      meetingService.updateSpeakingMode(id, speakingOrder),
    {
      onSuccess: (data) => {
        setSelectedMeeting(data);
        queryClient.invalidateQueries('meetings');
      },
    },
  );

  const titleMutation = useMutation(
    ({ id, title }: { id: string; title: string }) => meetingService.updateMeetingTitle(id, title),
    {
      onSuccess: (data) => {
        setSelectedMeeting(data);
        queryClient.invalidateQueries('meetings');
      },
    },
  );

  const addParticipantMutation = useMutation(
    ({ id, candidateKey }: { id: string; candidateKey: string }) => {
      const [type, participantId] = candidateKey.split(':') as ['employee' | 'agent', string];
      const displayName = participantDisplayMap.get(candidateKey) || participantId;
      return meetingService.addParticipant(id, {
        id: participantId,
        type,
        name: displayName,
        isHuman: type === 'employee',
      });
    },
    {
      onSuccess: (data) => {
        setSelectedMeeting(data);
        queryClient.invalidateQueries('meetings');
      },
    },
  );

  const removeParticipantMutation = useMutation(
    ({ id, participantId, participantType }: { id: string; participantId: string; participantType: 'employee' | 'agent' }) =>
      meetingService.removeParticipant(id, participantId, participantType),
    {
      onSuccess: (data) => {
        setSelectedMeeting(data);
        queryClient.invalidateQueries('meetings');
      },
    },
  );

  const archiveMutation = useMutation(meetingService.archiveMeeting, {
    onSuccess: () => {
      queryClient.invalidateQueries('meetings');
      queryClient.invalidateQueries('meeting-stats');
      setSelectedMeeting(null);
    },
  });

  const deleteMutation = useMutation(meetingService.deleteMeeting, {
    onSuccess: () => {
      queryClient.invalidateQueries('meetings');
      queryClient.invalidateQueries('meeting-stats');
      setSelectedMeeting(null);
    },
  });

  const joinMutation = useMutation(
    ({ id, agentId }: { id: string; agentId: string }) => 
      meetingService.joinMeeting(id, { id: agentId, type: 'employee', name: currentUser?.name || 'User', isHuman: true }),
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries('meetings');
        if (selectedMeeting?.id === data.id) {
          setSelectedMeeting(data);
        }
      },
    }
  );

  const sendMessageMutation = useMutation(
    ({ id, content }: { id: string; content: string }) => 
      meetingService.sendMessage(id, {
        senderId: currentUser?.id || 'unknown',
        senderType: 'employee',
        content,
        type: 'opinion',
      }),
    {
      onSuccess: (message) => {
        setNewMessage('');
        // Update selectedMeeting with the new message
        if (selectedMeeting) {
          setSelectedMeeting({
            ...selectedMeeting,
            messages: [...(selectedMeeting.messages || []), message],
            messageCount: (selectedMeeting.messageCount || 0) + 1,
          });
        }
        // Then invalidate to refresh in background
        setTimeout(() => {
          queryClient.invalidateQueries('meetings');
        }, 500);
      },
    }
  );

  const inviteMutation = useMutation(
    ({ id, agentId, invitedBy }: { id: string; agentId: string; invitedBy: string }) => 
      meetingService.inviteAgent(id, agentId, invitedBy),
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries('meetings');
        if (selectedMeeting?.id === data.id) {
          setSelectedMeeting(data);
        }
      },
    }
  );

  useEffect(() => {
    if (selectedMeeting) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedMeeting?.messages]);

  // WS实时事件驱动更新
  useEffect(() => {
    if (!selectedMeeting?.id) return;

    const meetingId = selectedMeeting.id;

    const unsubscribe = wsService.subscribe(`meeting:${meetingId}`, (raw) => {
      let event: MeetingRealtimeEvent;
      try {
        event = JSON.parse(raw) as MeetingRealtimeEvent;
      } catch {
        return;
      }

      if (!event || event.meetingId !== meetingId) return;

      if (event.type === 'message' && event.data) {
        setSelectedMeeting((current) => {
          if (!current || current.id !== meetingId) return current;
          const existing = current.messages || [];
          const alreadyExists = existing.some((msg) => msg.id === event.data.id);
          if (alreadyExists) return current;

          return {
            ...current,
            messages: [...existing, event.data],
            messageCount: (current.messageCount || 0) + 1,
          };
        });
        return;
      }

      if (event.type === 'summary_generated') {
        setSelectedMeeting((current) => {
          if (!current || current.id !== meetingId) return current;
          return {
            ...current,
            summary: {
              content: event.data?.summary || '',
              actionItems: current.summary?.actionItems || [],
              decisions: current.summary?.decisions || [],
              generatedAt: new Date().toISOString(),
            },
          };
        });
      }

      if (event.type === 'status_changed' && event.data?.status) {
        setSelectedMeeting((current) => {
          if (!current || current.id !== meetingId) return current;
          return { ...current, status: event.data.status };
        });
        queryClient.invalidateQueries('meeting-stats');
      }

      if (event.type === 'settings_changed' && event.data?.speakingOrder) {
        setSelectedMeeting((current) => {
          if (!current || current.id !== meetingId) return current;
          return {
            ...current,
            settings: {
              ...(current.settings || {}),
              speakingOrder: event.data.speakingOrder,
            },
          };
        });
      }

      if (event.type === 'settings_changed' && event.data?.title) {
        setSelectedMeeting((current) => {
          if (!current || current.id !== meetingId) return current;
          return {
            ...current,
            title: event.data.title,
          };
        });
      }

      if ((event.type === 'participant_joined' || event.type === 'participant_left') && event.data?.id) {
        setSelectedMeeting((current) => {
          if (!current || current.id !== meetingId) return current;
          const participants = [...(current.participants || [])];
          const participantIndex = participants.findIndex(
            (p) => p.participantId === event.data.id && p.participantType === event.data.type,
          );

          if (participantIndex >= 0) {
            participants[participantIndex] = {
              ...participants[participantIndex],
              isPresent: event.type === 'participant_joined',
            };
          } else if (event.type === 'participant_joined') {
            participants.push({
              participantId: event.data.id,
              participantType: event.data.type,
              role: ParticipantRole.PARTICIPANT,
              isPresent: true,
              hasSpoken: false,
              messageCount: 0,
            });
          }

          return {
            ...current,
            participants,
          };
        });
      }

    });

    return () => {
      unsubscribe();
    };
  }, [selectedMeeting?.id]);

  const getMeetingTypeInfo = (type: MeetingType) => {
    return MEETING_TYPES.find(t => t.id === type) || MEETING_TYPES[2];
  };

  const getSpeakingModeLabel = (mode?: string) => {
    if (mode === 'ordered' || mode === 'sequential' || mode === 'round_robin') {
      return '有序发言';
    }
    return '自由讨论';
  };

  const getParticipantDisplayName = (participantId: string, participantType: 'employee' | 'agent') => {
    return participantDisplayMap.get(`${participantType}:${participantId}`) || participantId;
  };

  const resetMention = () => {
    setMentionStart(null);
    setMentionQuery('');
    setMentionActiveIndex(0);
  };

  const updateMentionState = (value: string, caretPosition: number | null) => {
    if (caretPosition === null || caretPosition < 0) {
      resetMention();
      return;
    }

    const textBeforeCaret = value.slice(0, caretPosition);
    const atIndex = textBeforeCaret.lastIndexOf('@');
    if (atIndex === -1) {
      resetMention();
      return;
    }

    const prefix = textBeforeCaret.slice(Math.max(0, atIndex - 1), atIndex);
    if (prefix && !/\s|\(|\[|\{|\n/.test(prefix)) {
      resetMention();
      return;
    }

    const query = textBeforeCaret.slice(atIndex + 1);
    if (/\s/.test(query)) {
      resetMention();
      return;
    }

    setMentionStart(atIndex);
    setMentionQuery(query);
    setMentionActiveIndex(0);
  };

  const applyMentionCandidate = (candidate: MentionCandidate) => {
    if (!messageInputRef.current || mentionStart === null) {
      return;
    }

    const input = messageInputRef.current;
    const caretPosition = input.selectionStart ?? newMessage.length;
    const before = newMessage.slice(0, mentionStart);
    const after = newMessage.slice(caretPosition);
    const mentionText = `@${candidate.name} `;
    const nextMessage = `${before}${mentionText}${after}`;
    const nextCaret = before.length + mentionText.length;

    setNewMessage(nextMessage);
    resetMention();

    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const getStatusBadge = (status: MeetingStatus) => {
    const styles: Record<string, string> = {
      [MeetingStatus.PENDING]: 'bg-gray-100 text-gray-800',
      [MeetingStatus.ACTIVE]: 'bg-green-100 text-green-800',
      [MeetingStatus.PAUSED]: 'bg-yellow-100 text-yellow-800',
      [MeetingStatus.ENDED]: 'bg-red-100 text-red-800',
      [MeetingStatus.ARCHIVED]: 'bg-blue-100 text-blue-800',
    };
    const labels: Record<string, string> = {
      [MeetingStatus.PENDING]: '待开始',
      [MeetingStatus.ACTIVE]: '进行中',
      [MeetingStatus.PAUSED]: '已暂停',
      [MeetingStatus.ENDED]: '已结束',
      [MeetingStatus.ARCHIVED]: '已归档',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  if (meetingsLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className={isChatOnlyMode ? 'h-screen flex bg-gray-50' : 'h-[calc(100vh-6rem)] flex'}>
      {/* 左侧会议列表 */}
      {!isChatOnlyMode && (
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-semibold text-gray-900">会议室</h1>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
            >
              <PlusIcon className="h-4 w-4 mr-1" />
              新建
            </button>
          </div>
          
          {/* 统计 */}
          {stats && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-50 rounded p-2">
                <div className="text-lg font-semibold text-gray-900">{stats.total}</div>
                <div className="text-xs text-gray-500">总会议</div>
              </div>
              <div className="bg-green-50 rounded p-2">
                <div className="text-lg font-semibold text-green-600">
                  {stats.byStatus.find(s => s._id === 'active')?.count || 0}
                </div>
                <div className="text-xs text-gray-500">进行中</div>
              </div>
              <div className="bg-blue-50 rounded p-2">
                <div className="text-lg font-semibold text-blue-600">{stats.totalMessages}</div>
                <div className="text-xs text-gray-500">总消息</div>
              </div>
            </div>
          )}
        </div>

        {/* 会议列表 */}
        <div className="flex-1 overflow-y-auto">
          {meetings?.map((meeting) => {
            const typeInfo = getMeetingTypeInfo(meeting.type);
            const presentCount = (meeting.participants || []).filter(p => p.isPresent).length;
            
            return (
              <div
                key={meeting.id}
                onClick={() => {
                  setPinnedMeetingId(meeting.id);
                  setSelectedMeeting(meeting);

                  if (!isChatOnlyMode && searchParams.get('meetingId')) {
                    setSearchParams({}, { replace: true });
                  }
                }}
                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedMeeting?.id === meeting.id ? 'bg-primary-50 border-l-4 border-l-primary-600' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-gray-900 truncate">{meeting.title}</h3>
                  {getStatusBadge(meeting.status)}
                </div>
                <div className="flex items-center text-sm text-gray-500 mb-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs mr-2 ${typeInfo.color}`}>
                    {typeInfo.icon} {typeInfo.name}
                  </span>
                  <span className="flex items-center">
                    <UserGroupIcon className="h-3 w-3 mr-1" />
                    {presentCount}/{(meeting.participants || []).length}
                  </span>
                </div>
                <div className="flex items-center text-xs text-gray-400">
                  <ChatBubbleLeftRightIcon className="h-3 w-3 mr-1" />
                  {meeting.messageCount} 条消息
                  {meeting.startedAt && (
                    <>
                      <span className="mx-2">•</span>
                      <ClockIcon className="h-3 w-3 mr-1" />
                      {new Date(meeting.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          
          {meetings?.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <VideoCameraIcon className="h-12 w-12 mx-auto mb-2 text-gray-300" />
              <p>暂无会议</p>
              <p className="text-sm">点击"新建"创建第一个会议</p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* 右侧会议详情/讨论区 */}
      <div className="flex-1 bg-gray-50 flex flex-col min-w-0">
        {selectedMeeting ? (
          <>
            {/* 会议头部 */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-semibold text-gray-900">{selectedMeeting.title}</h2>
                    {getStatusBadge(selectedMeeting.status)}
                  </div>
                  <p className="text-sm text-gray-500">{selectedMeeting.description}</p>
                  {selectedMeeting.agenda && (
                    <p className="text-sm text-gray-600 mt-1">
                      <span className="font-medium">议程：</span>{selectedMeeting.agenda}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-500">发言模式:</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                      {getSpeakingModeLabel(selectedMeeting.settings?.speakingOrder)}
                    </span>
                    {selectedMeeting.status !== MeetingStatus.ENDED && selectedMeeting.status !== MeetingStatus.ARCHIVED && (
                      <>
                        <button
                          onClick={() => speakingModeMutation.mutate({ id: selectedMeeting.id, speakingOrder: 'free' })}
                          disabled={speakingModeMutation.isLoading || getSpeakingModeLabel(selectedMeeting.settings?.speakingOrder) === '自由讨论'}
                          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          自由讨论
                        </button>
                        <button
                          onClick={() => speakingModeMutation.mutate({ id: selectedMeeting.id, speakingOrder: 'ordered' })}
                          disabled={speakingModeMutation.isLoading || getSpeakingModeLabel(selectedMeeting.settings?.speakingOrder) === '有序发言'}
                          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          有序发言
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => window.open(`/meetings/${selectedMeeting.id}`, '_blank', 'noopener,noreferrer')}
                    className="inline-flex items-center justify-center h-9 w-9 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
                    title="在新页面打开此会议"
                    aria-label="在新页面打开此会议"
                  >
                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  </button>
                  {selectedMeeting.status === MeetingStatus.PENDING && (
                    <>
                      <button
                        onClick={() => startMutation.mutate({
                          id: selectedMeeting.id,
                          startedById: selectedMeeting.hostId,
                          startedByType: selectedMeeting.hostType || 'employee',
                          startedByName: currentUser?.name || '主持人',
                        })}
                        disabled={startMutation.isLoading}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                      >
                        <PlayIcon className="h-4 w-4 mr-1" />
                        开始会议
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('确定要删除此未开始会议吗？此操作不可撤销。')) {
                            deleteMutation.mutate(selectedMeeting.id);
                          }
                        }}
                        disabled={deleteMutation.isLoading}
                        className="inline-flex items-center justify-center h-9 w-9 border border-transparent rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                        title={deleteMutation.isLoading ? '删除中' : '删除会议'}
                        aria-label={deleteMutation.isLoading ? '删除中' : '删除会议'}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {selectedMeeting.status === MeetingStatus.ACTIVE && (
                    <>
                      <button
                        onClick={() => pauseMutation.mutate(selectedMeeting.id)}
                        disabled={pauseMutation.isLoading}
                        className="inline-flex items-center justify-center h-9 w-9 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                        title={pauseMutation.isLoading ? '暂停中' : '暂停会议'}
                        aria-label={pauseMutation.isLoading ? '暂停中' : '暂停会议'}
                      >
                        <PauseIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => endMutation.mutate(selectedMeeting.id)}
                        disabled={endMutation.isLoading}
                        className="inline-flex items-center justify-center h-9 w-9 border border-transparent rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                        title={endMutation.isLoading ? '结束中' : '结束会议'}
                        aria-label={endMutation.isLoading ? '结束中' : '结束会议'}
                      >
                        <StopIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {selectedMeeting.status === MeetingStatus.PAUSED && (
                    <>
                      <button
                        onClick={() => resumeMutation.mutate(selectedMeeting.id)}
                        disabled={resumeMutation.isLoading}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                      >
                        <PlayIcon className="h-4 w-4 mr-1" />
                        {resumeMutation.isLoading ? '恢复中...' : '恢复会议'}
                      </button>
                      <button
                        onClick={() => endMutation.mutate(selectedMeeting.id)}
                        disabled={endMutation.isLoading}
                        className="inline-flex items-center justify-center h-9 w-9 border border-transparent rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                        title={endMutation.isLoading ? '结束中' : '结束会议'}
                        aria-label={endMutation.isLoading ? '结束中' : '结束会议'}
                      >
                        <StopIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {selectedMeeting.status === MeetingStatus.ENDED && (
                    <>
                      <button
                        onClick={() => archiveMutation.mutate(selectedMeeting.id)}
                        disabled={archiveMutation.isLoading}
                        className="inline-flex items-center justify-center h-9 w-9 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                        title={archiveMutation.isLoading ? '归档中' : '归档会议'}
                        aria-label={archiveMutation.isLoading ? '归档中' : '归档会议'}
                      >
                        <ArchiveBoxIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('确定要删除此会议吗？此操作不可撤销。')) {
                            deleteMutation.mutate(selectedMeeting.id);
                          }
                        }}
                        disabled={deleteMutation.isLoading}
                        className="inline-flex items-center justify-center h-9 w-9 border border-transparent rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                        title={deleteMutation.isLoading ? '删除中' : '删除会议'}
                        aria-label={deleteMutation.isLoading ? '删除中' : '删除会议'}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  {selectedMeeting.status === MeetingStatus.ARCHIVED && (
                    <button
                      onClick={() => {
                        if (window.confirm('确定要删除此已归档会议吗？此操作不可撤销。')) {
                          deleteMutation.mutate(selectedMeeting.id);
                        }
                      }}
                      disabled={deleteMutation.isLoading}
                      className="inline-flex items-center justify-center h-9 w-9 border border-transparent rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                      title={deleteMutation.isLoading ? '删除中' : '删除会议'}
                      aria-label={deleteMutation.isLoading ? '删除中' : '删除会议'}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* 参与者列表 */}
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-gray-500">参与者：</span>
                <div className="flex items-center gap-1">
                  {(selectedMeeting.participants || []).map((participant) => {
                    const legacyParticipant = participant as any;
                    const participantId = participant.participantId || legacyParticipant.agentId || 'unknown';
                    const participantName = getParticipantDisplayName(participantId, participant.participantType);
                    return (
                      <div
                        key={participantId}
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 ${
                          participant.isPresent 
                            ? 'bg-green-500 text-white border-green-500' 
                            : 'bg-gray-200 text-gray-600 border-gray-300'
                        }`}
                        title={`${participantName} ${participant.isPresent ? '(在线)' : '(离线)'}`}
                      >
                        {participantName.charAt(0).toUpperCase()}
                      </div>
                    );
                  })}
                  
                  {/* 邀请按钮 */}
                  {selectedMeeting.status !== MeetingStatus.ENDED && agents && (
                    <div className="relative group">
                      <button className="w-8 h-8 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:border-gray-400">
                        <UserPlusIcon className="h-4 w-4" />
                      </button>
                      
                      {/* 邀请下拉菜单 */}
                      <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 hidden group-hover:block">
                        <div className="p-2 max-h-48 overflow-y-auto">
                          <p className="text-xs text-gray-500 mb-2 px-2">点击邀请Agent</p>
                          {agents
                            .filter(a => 
                              a.isActive && 
                              !(selectedMeeting.participants || []).some(p => p.agentId === a.id || p.participantId === a.id) &&
                              !(selectedMeeting.invitedAgentIds || []).includes(a.id!)
                            )
                            .map(agent => (
                              <button
                                key={agent.id}
                                onClick={() => inviteMutation.mutate({
                                  id: selectedMeeting.id,
                                  agentId: agent.id!,
                                  invitedBy: selectedMeeting.hostId,
                                })}
                                className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 rounded flex items-center"
                              >
                                <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs mr-2">
                                  {agent.name.charAt(0)}
                                </div>
                                {agent.name}
                              </button>
                            ))}
                          {agents.filter(a => 
                            a.isActive && 
                            !(selectedMeeting.participants || []).some(p => p.agentId === a.id || p.participantId === a.id) &&
                            !(selectedMeeting.invitedAgentIds || []).includes(a.id!)
                          ).length === 0 && (
                            <p className="text-xs text-gray-400 px-2 py-1">没有可邀请的Agent</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {(selectedMeeting.invitedAgentIds || []).length > 0 && (
                  <span className="text-xs text-gray-400 ml-2">
                    +{(selectedMeeting.invitedAgentIds || []).length} 已邀请
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 flex">
              <div className="flex-1 min-h-0 flex flex-col">
                {/* 消息区域 */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {selectedMeeting.status === MeetingStatus.PENDING ? (
                    <div className="text-center py-12 text-gray-400">
                      <ChatBubbleLeftRightIcon className="h-16 w-16 mx-auto mb-4 text-gray-200" />
                      <p>会议尚未开始</p>
                      <p className="text-sm">点击"开始会议"按钮开始讨论</p>
                    </div>
                  ) : (selectedMeeting.messages || []).length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <ChatBubbleLeftRightIcon className="h-16 w-16 mx-auto mb-4 text-gray-200" />
                      <p>等待第一条消息</p>
                      <p className="text-sm">发送消息开始讨论，AI Agent会自动回复</p>
                    </div>
                  ) : (
                    selectedMeeting.messages.map((message, index) => {
                      const legacyMessage = message as any;
                      const senderId = message.senderId || legacyMessage.agentId || 'unknown';
                      const senderName = getParticipantDisplayName(senderId, message.senderType === 'agent' ? 'agent' : 'employee');
                      const isSystem = message.senderType === 'system';
                      const isUser = message.senderType === 'employee';

                      return (
                        <div
                          key={message.id || index}
                          className={`flex ${isSystem ? 'justify-center' : isUser ? 'justify-end' : 'justify-start'}`}
                        >
                          {isSystem ? (
                            <div className="bg-gray-100 text-gray-600 text-sm px-4 py-2 rounded-full">
                              {message.content}
                            </div>
                          ) : (
                            <div className={`max-w-[70%] ${isUser ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200'} rounded-lg px-4 py-3 shadow-sm`}>
                              {!isUser && (
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium">
                                    {senderName.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="text-xs font-medium text-gray-600">
                                    {senderName}
                                  </span>
                                  {message.type && message.type !== 'opinion' && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                      {message.type === 'question' ? '提问' :
                                       message.type === 'agreement' ? '赞同' :
                                       message.type === 'disagreement' ? '反对' :
                                       message.type === 'suggestion' ? '建议' :
                                       message.type === 'introduction' ? '入场' :
                                       message.type === 'action_item' ? '行动项' : '观点'}
                                    </span>
                                  )}
                                </div>
                              )}
                              <p className={`text-sm ${isUser ? 'text-white' : 'text-gray-800'} whitespace-pre-wrap`}>
                                {message.content}
                              </p>
                              <div className={`text-xs mt-1 ${isUser ? 'text-primary-200' : 'text-gray-400'}`}>
                                {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* 输入框 */}
                {selectedMeeting.status === MeetingStatus.ACTIVE && (
                  <div className="bg-white border-t border-gray-200 px-6 py-4">
                    {(() => {
                      const isParticipant = (selectedMeeting.participants || []).some(
                        p => p.participantId === currentUser?.id && p.isPresent,
                      );
                      const isHost = selectedMeeting.hostId === currentUser?.id;

                      if (!isParticipant && !isHost) {
                        return (
                          <div className="text-center py-4">
                            <button
                              onClick={() => joinMutation.mutate({
                                id: selectedMeeting.id,
                                agentId: currentUser?.id,
                              })}
                              disabled={joinMutation.isLoading}
                              className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                            >
                              {joinMutation.isLoading ? '加入中...' : '加入会议'}
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div className="relative">
                          <div className="flex gap-2">
                            <textarea
                              ref={messageInputRef}
                              value={newMessage}
                              onChange={(event) => {
                                setNewMessage(event.target.value);
                                if (!isComposing) {
                                  updateMentionState(event.target.value, event.target.selectionStart);
                                }
                              }}
                              onClick={(event) => updateMentionState(newMessage, event.currentTarget.selectionStart)}
                              onKeyUp={(event) => {
                                if (!isComposing) {
                                  updateMentionState(newMessage, event.currentTarget.selectionStart);
                                }
                              }}
                              onCompositionStart={() => setIsComposing(true)}
                              onCompositionEnd={(event) => {
                                setIsComposing(false);
                                updateMentionState(event.currentTarget.value, event.currentTarget.selectionStart);
                              }}
                              onKeyDown={(event) => {
                                if (mentionStart !== null && filteredMentionCandidates.length > 0) {
                                  if (event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    setMentionActiveIndex((prev) => (prev + 1) % filteredMentionCandidates.length);
                                    return;
                                  }
                                  if (event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    setMentionActiveIndex((prev) => (prev - 1 + filteredMentionCandidates.length) % filteredMentionCandidates.length);
                                    return;
                                  }
                                  if (event.key === 'Enter' || event.key === 'Tab') {
                                    event.preventDefault();
                                    applyMentionCandidate(filteredMentionCandidates[mentionActiveIndex]);
                                    return;
                                  }
                                  if (event.key === 'Escape') {
                                    event.preventDefault();
                                    resetMention();
                                    return;
                                  }
                                }

                                if (event.key === 'Enter' && !event.shiftKey && newMessage.trim()) {
                                  event.preventDefault();
                                  sendMessageMutation.mutate({ id: selectedMeeting.id, content: newMessage });
                                  resetMention();
                                }
                              }}
                              placeholder="输入消息（输入 @ 可快速点名参会成员）..."
                              rows={2}
                              className="flex-1 resize-none border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                            <button
                              onClick={() => {
                                if (newMessage.trim()) {
                                  sendMessageMutation.mutate({ id: selectedMeeting.id, content: newMessage });
                                  resetMention();
                                }
                              }}
                              disabled={sendMessageMutation.isLoading || !newMessage.trim()}
                              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <PaperAirplaneIcon className="h-5 w-5" />
                            </button>
                          </div>

                          {mentionStart !== null && filteredMentionCandidates.length > 0 && (
                            <div className="absolute z-20 bottom-full mb-2 left-0 w-72 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                              {filteredMentionCandidates.map((candidate, index) => (
                                <button
                                  key={`${candidate.type}:${candidate.id}`}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    applyMentionCandidate(candidate);
                                  }}
                                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${index === mentionActiveIndex ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50 text-gray-700'}`}
                                >
                                  <span className="truncate">{candidate.name}</span>
                                  <span className="text-xs text-gray-400 ml-2">{candidate.type === 'agent' ? 'Agent' : '成员'}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {selectedMeeting.status === MeetingStatus.PAUSED && (
                  <div className="bg-white border-t border-gray-200 px-6 py-4 text-sm text-yellow-700">
                    会议已暂停，恢复后可继续发言。
                  </div>
                )}

                {/* 会议总结 */}
                {selectedMeeting.summary && (
                  <div className="bg-blue-50 border-t border-blue-200 px-6 py-4">
                    <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center">
                      <CheckCircleIcon className="h-4 w-4 mr-1" />
                      会议总结
                    </h3>
                    <div className="text-sm text-blue-800 whitespace-pre-wrap">
                      {selectedMeeting.summary.content}
                    </div>
                    {(selectedMeeting.summary?.actionItems || []).length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-blue-900">行动项：</p>
                        <ul className="text-xs text-blue-800 list-disc list-inside mt-1">
                          {(selectedMeeting.summary?.actionItems || []).map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <aside
                className={`bg-white border-l border-gray-200 transition-all duration-200 ${isOperationsCollapsed ? 'w-12' : 'w-80'}`}
              >
                  <div className="h-full flex flex-col">
                    <div className="h-12 border-b border-gray-200 flex items-center justify-between px-2">
                      {!isOperationsCollapsed && <h3 className="text-sm font-semibold text-gray-900">会议操作区</h3>}
                      <button
                        onClick={() => setIsOperationsCollapsed((prev) => !prev)}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-600 hover:bg-gray-100"
                        title={isOperationsCollapsed ? '展开操作区' : '折叠操作区'}
                        aria-label={isOperationsCollapsed ? '展开操作区' : '折叠操作区'}
                      >
                        {isOperationsCollapsed ? (
                          <ChevronLeftIcon className="h-4 w-4" />
                        ) : (
                          <ChevronRightIcon className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {!isOperationsCollapsed && (
                      <div className="flex-1 overflow-y-auto p-4">
                        <div className="mb-6">
                          <p className="text-xs text-gray-500 mb-2">会议名称</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={titleDraft}
                              onChange={(event) => setTitleDraft(event.target.value)}
                              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                            <button
                              onClick={() => {
                                if (titleDraft.trim() && titleDraft.trim() !== selectedMeeting.title) {
                                  titleMutation.mutate({ id: selectedMeeting.id, title: titleDraft.trim() });
                                }
                              }}
                              disabled={titleMutation.isLoading || !titleDraft.trim() || titleDraft.trim() === selectedMeeting.title}
                              className="px-3 py-2 rounded-md text-sm bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                            >
                              保存
                            </button>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs text-gray-500 mb-2">参会人员管理</p>
                          <div className="space-y-2 mb-3 max-h-72 overflow-y-auto pr-1">
                            {(selectedMeeting.participants || []).map((participant) => {
                              const participantName = getParticipantDisplayName(participant.participantId, participant.participantType);
                              const isHost = participant.participantId === selectedMeeting.hostId && participant.participantType === selectedMeeting.hostType;
                              return (
                                <div key={`${participant.participantType}:${participant.participantId}`} className="flex items-center justify-between text-sm border border-gray-200 rounded-md px-3 py-2">
                                  <div>
                                    <p className="font-medium text-gray-800">{participantName}</p>
                                    <p className="text-xs text-gray-500">
                                      {participant.participantType === 'agent' ? 'Agent' : '成员'}
                                      {isHost ? ' · 主持人' : ''}
                                    </p>
                                  </div>
                                  {!isHost && (
                                    <button
                                      onClick={() => removeParticipantMutation.mutate({
                                        id: selectedMeeting.id,
                                        participantId: participant.participantId,
                                        participantType: participant.participantType,
                                      })}
                                      disabled={removeParticipantMutation.isLoading}
                                      className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      移除
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          <div className="border border-dashed border-gray-300 rounded-md p-3">
                            <p className="text-xs text-gray-500 mb-2">添加参会人员</p>
                            <div className="flex gap-2">
                              <select
                                value={selectedCandidateKey}
                                onChange={(event) => setSelectedCandidateKey(event.target.value)}
                                className="flex-1 border border-gray-300 rounded-md px-2 py-2 text-sm"
                              >
                                {managementCandidates.length === 0 && (
                                  <option value="">暂无可添加成员</option>
                                )}
                                {managementCandidates.map((candidate) => (
                                  <option key={candidate.key} value={candidate.key}>
                                    {candidate.name} ({candidate.type === 'agent' ? 'Agent' : '成员'})
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => {
                                  if (selectedCandidateKey) {
                                    addParticipantMutation.mutate({ id: selectedMeeting.id, candidateKey: selectedCandidateKey });
                                  }
                                }}
                                disabled={addParticipantMutation.isLoading || !selectedCandidateKey || managementCandidates.length === 0}
                                className="px-3 py-2 rounded-md text-sm bg-gray-900 text-white hover:bg-black disabled:opacity-50"
                              >
                                添加
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </aside>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <VideoCameraIcon className="h-16 w-16 mx-auto mb-4 text-gray-200" />
              {isChatOnlyMode ? (
                <>
                  <p className="text-lg">未找到该会议</p>
                  <p className="text-sm mt-1">请检查链接是否正确</p>
                </>
              ) : (
                <>
                  <p className="text-lg">选择一个会议开始</p>
                  <p className="text-sm mt-1">或创建新会议</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 创建会议模态框 */}
      {!isChatOnlyMode && isCreateModalOpen && (
        <CreateMeetingModal
          agents={agents?.filter(a => a.isActive) || []}
          currentUser={currentUser}
          onClose={() => setIsCreateModalOpen(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isLoading}
        />
      )}
    </div>
  );
};

// 创建会议模态框
const CreateMeetingModal: React.FC<{
  agents: Agent[];
  currentUser: any;
  onClose: () => void;
  onCreate: (data: CreateMeetingDto) => void;
  isLoading: boolean;
}> = ({ agents, currentUser, onClose, onCreate, isLoading }) => {
  const [formData, setFormData] = useState<Partial<CreateMeetingDto>>({
    title: '',
    description: '',
    type: MeetingType.DAILY,
    hostId: currentUser ? `${currentUser.id}|employee` : '',
    hostType: 'employee',
    participantIds: [],
    agenda: '',
  });

  useEffect(() => {
    if (currentUser) {
      setFormData({
        title: '',
        description: '',
        type: MeetingType.DAILY,
        hostId: `${currentUser.id}|employee`,
        hostType: 'employee',
        participantIds: [],
        agenda: '',
      });
    }
  }, [currentUser]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.title && formData.hostId) {
      const [hostId, hostType] = formData.hostId.split('|');
      onCreate({
        ...formData,
        hostId,
        hostType: hostType as 'employee' | 'agent',
      } as CreateMeetingDto);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">创建新会议</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                会议标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="例如：产品需求评审会议"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                会议类型 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {MEETING_TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, type: type.id })}
                    className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                      formData.type === type.id
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="mr-1">{type.icon}</span>
                    {type.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder="会议目的和背景..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">议程</label>
              <textarea
                value={formData.agenda}
                onChange={(e) => setFormData({ ...formData, agenda: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={2}
                placeholder="1. 讨论议题A\n2. 讨论议题B\n3. 决策和行动计划"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                主持人 <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.hostId}
                onChange={(e) => {
                  const [id, type] = e.target.value.split('|');
                  setFormData({ ...formData, hostId: id, hostType: type as 'employee' | 'agent' });
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">选择主持人</option>
                {currentUser && (
                  <option value={`${currentUser.id}|employee`}>
                    {currentUser.name || currentUser.email} (我)
                  </option>
                )}
                {agents.map((agent) => (
                  <option key={agent.id} value={`${agent.id}|agent`}>
                    {agent.name} (Agent)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">参与者 (可多选)</label>
              <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                {currentUser && currentUser.id !== formData.hostId?.split('|')[0] && (
                  <label className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer border-b mb-2">
                    <input
                      type="checkbox"
                      checked={formData.participantIds?.some(p => p.id === currentUser.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            participantIds: [...(formData.participantIds || []), { id: currentUser.id, type: 'employee' }],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            participantIds: formData.participantIds?.filter(p => p.id !== currentUser.id) || [],
                          });
                        }
                      }}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-900">{currentUser.name || currentUser.email}</p>
                      <p className="text-xs text-gray-500">我 (员工)</p>
                    </div>
                  </label>
                )}
                {agents
                  .filter(a => formData.hostId ? a.id !== formData.hostId.split('|')[0] : true)
                  .map((agent) => (
                    <label key={agent.id} className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.participantIds?.some(p => p.id === agent.id) || false}
                        onChange={(e) => {
                          const currentParticipants = formData.participantIds || [];
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              participantIds: [...currentParticipants, { id: agent.id, type: 'agent' as const }],
                            });
                          } else {
                            setFormData({
                              ...formData,
                              participantIds: currentParticipants.filter(p => p.id !== agent.id),
                            });
                          }
                        }}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{agent.name}</p>
                        <p className="text-xs text-gray-500">{agent.type}</p>
                      </div>
                    </label>
                  ))}
                {(agents.length === 0 || agents.filter(a => formData.hostId ? a.id !== formData.hostId.split('|')[0] : true).length === 0) && (
                  <p className="text-sm text-gray-500 text-center py-4">没有其他可用的Agent</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isLoading || !formData.title || !formData.hostId}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {isLoading ? '创建中...' : '创建会议'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Meetings;
