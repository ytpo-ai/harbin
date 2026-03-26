import { useEffect, useRef } from 'react';
import type React from 'react';
import { QueryClient } from 'react-query';
import { ParticipantRole } from '../../../services/meetingService';
import { wsService } from '../../../services/wsService';
import { MeetingRealtimeEvent } from '../types';

type Params = {
  meetingId?: string;
  queryClient: QueryClient;
  setSelectedMeeting: React.Dispatch<React.SetStateAction<any>>;
  setThinkingAgentIds: React.Dispatch<React.SetStateAction<string[]>>;
};

export const useMeetingRealtime = ({ meetingId, queryClient, setSelectedMeeting, setThinkingAgentIds }: Params) => {
  const meetingIdRef = useRef<string | undefined>(meetingId);

  useEffect(() => {
    meetingIdRef.current = meetingId;
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId) {
      return;
    }

    const unsubscribe = wsService.subscribe(`meeting:${meetingId}`, (raw) => {
      let event: MeetingRealtimeEvent;
      try {
        event = JSON.parse(raw) as MeetingRealtimeEvent;
      } catch {
        return;
      }

      if (!event || event.meetingId !== meetingIdRef.current) {
        return;
      }

      if (event.type === 'message' && event.data) {
        setSelectedMeeting((current: any) => {
          if (!current || current.id !== meetingIdRef.current) {
            return current;
          }
          const existing = current.messages || [];
          const alreadyExists = existing.some((msg: any) => msg.id === event.data.id);
          if (alreadyExists) {
            return current;
          }
          return {
            ...current,
            messages: [...existing, event.data],
            messageCount: (current.messageCount || 0) + 1,
          };
        });
        return;
      }

      if (event.type === 'agent_state_changed' && event.data?.agentId) {
        setThinkingAgentIds((current) => {
          const next = new Set(current);
          if (event.data.state === 'thinking') {
            next.add(event.data.agentId);
          } else {
            next.delete(event.data.agentId);
          }
          return Array.from(next);
        });
        return;
      }

      if (event.type === 'summary_generated') {
        setSelectedMeeting((current: any) => {
          if (!current || current.id !== meetingIdRef.current) {
            return current;
          }
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
        setSelectedMeeting((current: any) => {
          if (!current || current.id !== meetingIdRef.current) {
            return current;
          }
          return { ...current, status: event.data.status };
        });
        queryClient.invalidateQueries('meeting-stats');
      }

      if (event.type === 'settings_changed' && event.data?.speakingOrder) {
        setSelectedMeeting((current: any) => {
          if (!current || current.id !== meetingIdRef.current) {
            return current;
          }
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
        setSelectedMeeting((current: any) => {
          if (!current || current.id !== meetingIdRef.current) {
            return current;
          }
          return {
            ...current,
            title: event.data.title,
          };
        });
      }

      if ((event.type === 'participant_joined' || event.type === 'participant_left') && event.data?.id) {
        setSelectedMeeting((current: any) => {
          if (!current || current.id !== meetingIdRef.current) {
            return current;
          }

          const participants = [...(current.participants || [])];
          const participantIndex = participants.findIndex(
            (participant: any) =>
              participant.participantId === event.data.id && participant.participantType === event.data.type,
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
  }, [meetingId, queryClient, setSelectedMeeting, setThinkingAgentIds]);
};
