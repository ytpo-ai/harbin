import { useMutation, useQueryClient } from 'react-query';
import { meetingService } from '../../../services/meetingService';
import { mergeMeetingMessages } from '../utils';
import { MeetingMutationPayloads } from '../types';

export const useMeetingMutations = ({
  selectedMeeting,
  setSelectedMeeting,
  setIsCreateModalOpen,
  currentUser,
  participantDisplayMap,
  setNewMessage,
  resetMessageHistoryState,
}: MeetingMutationPayloads) => {
  const queryClient = useQueryClient();

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
      meetingService.startMeeting(id, {
        id: startedById,
        type: startedByType,
        name: startedByName,
        isHuman: startedByType === 'employee',
      }),
    {
      onSuccess: (data) => {
        setSelectedMeeting(data);
        setTimeout(() => {
          queryClient.invalidateQueries('meetings');
        }, 500);
      },
    },
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
    ({ id, speakingOrder }: { id: string; speakingOrder: 'free' | 'ordered' }) => meetingService.updateSpeakingMode(id, speakingOrder),
    {
      onSuccess: (data) => {
        setSelectedMeeting(data);
        queryClient.invalidateQueries('meetings');
      },
    },
  );

  const titleMutation = useMutation(({ id, title }: { id: string; title: string }) => meetingService.updateMeetingTitle(id, title), {
    onSuccess: (data) => {
      setSelectedMeeting(data);
      queryClient.invalidateQueries('meetings');
    },
  });

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
        setSelectedMeeting((current) => {
          if (!current || current.id !== data.id) {
            return data;
          }

          const messages = mergeMeetingMessages(current, data);
          return {
            ...current,
            ...data,
            messages,
            messageCount: Math.max(current.messageCount || 0, data.messageCount || 0, messages.length),
          };
        });
        queryClient.invalidateQueries('meetings');
      },
    },
  );

  const removeParticipantMutation = useMutation(
    ({ id, participantId, participantType }: { id: string; participantId: string; participantType: 'employee' | 'agent' }) =>
      meetingService.removeParticipant(id, participantId, participantType),
    {
      onSuccess: (data) => {
        setSelectedMeeting((current) => {
          if (!current || current.id !== data.id) {
            return data;
          }

          const messages = mergeMeetingMessages(current, data);
          return {
            ...current,
            ...data,
            messages,
            messageCount: Math.max(current.messageCount || 0, data.messageCount || 0, messages.length),
          };
        });
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
        resetMessageHistoryState();
        if (selectedMeeting) {
          setSelectedMeeting({
            ...selectedMeeting,
            messages: [...(selectedMeeting.messages || []), message],
            messageCount: (selectedMeeting.messageCount || 0) + 1,
          });
        }
        setTimeout(() => {
          queryClient.invalidateQueries('meetings');
        }, 500);
      },
    },
  );

  const pauseMessageResponseMutation = useMutation(
    ({ id, messageId, employeeId }: { id: string; messageId: string; employeeId: string }) =>
      meetingService.pauseMessageResponse(id, messageId, employeeId),
    {
      onSuccess: (updatedMessage) => {
        setSelectedMeeting((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            messages: (current.messages || []).map((message) => (message.id === updatedMessage.id ? updatedMessage : message)),
          };
        });
      },
    },
  );

  const revokePausedMessageMutation = useMutation(
    ({ id, messageId, employeeId }: { id: string; messageId: string; employeeId: string }) =>
      meetingService.revokePausedMessage(id, messageId, employeeId),
    {
      onSuccess: (updatedMeeting) => {
        setSelectedMeeting((current) => {
          if (!current || current.id !== updatedMeeting.id) {
            return updatedMeeting;
          }
          return {
            ...current,
            ...updatedMeeting,
            messages: updatedMeeting.messages || [],
            messageCount: updatedMeeting.messageCount ?? (updatedMeeting.messages || []).length,
          };
        });
        setTimeout(() => {
          queryClient.invalidateQueries('meetings');
        }, 300);
      },
    },
  );

  const inviteMutation = useMutation(
    ({ id, agentId, invitedBy }: { id: string; agentId: string; invitedBy: string }) => meetingService.inviteAgent(id, agentId, invitedBy),
    {
      onSuccess: (data) => {
        queryClient.invalidateQueries('meetings');
        if (selectedMeeting?.id === data.id) {
          setSelectedMeeting(data);
        }
      },
    },
  );

  const stopAndDeleteMeeting = async (meetingId: string) => {
    if (!window.confirm('确定要停止并删除此会议吗？此操作不可撤销。')) {
      return;
    }

    try {
      await endMutation.mutateAsync(meetingId);
      await deleteMutation.mutateAsync(meetingId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '停止并删除失败';
      alert(message);
    }
  };

  const openMeetingInNewTab = (meetingId: string) => {
    window.open(`/meetings/${meetingId}`, '_blank', 'noopener,noreferrer');
  };

  return {
    createMeeting: createMutation.mutate,
    isCreatingMeeting: createMutation.isLoading,
    startMeeting: startMutation.mutate,
    isStartingMeeting: startMutation.isLoading,
    pauseMeeting: pauseMutation.mutate,
    isPausingMeeting: pauseMutation.isLoading,
    resumeMeeting: resumeMutation.mutate,
    isResumingMeeting: resumeMutation.isLoading,
    endMeeting: endMutation.mutate,
    isEndingMeeting: endMutation.isLoading,
    archiveMeeting: archiveMutation.mutate,
    isArchivingMeeting: archiveMutation.isLoading,
    deleteMeeting: deleteMutation.mutate,
    isDeletingMeeting: deleteMutation.isLoading,
    stopAndDeleteMeeting,
    openMeetingInNewTab,
    updateSpeakingMode: speakingModeMutation.mutate,
    isUpdatingSpeakingMode: speakingModeMutation.isLoading,
    updateMeetingTitle: titleMutation.mutate,
    isUpdatingMeetingTitle: titleMutation.isLoading,
    addParticipant: addParticipantMutation.mutate,
    isAddingParticipant: addParticipantMutation.isLoading,
    removeParticipant: removeParticipantMutation.mutate,
    isRemovingParticipant: removeParticipantMutation.isLoading,
    sendMessage: sendMessageMutation.mutate,
    isSendingMessage: sendMessageMutation.isLoading,
    pauseMessageResponse: pauseMessageResponseMutation.mutate,
    isPausingMessageResponse: pauseMessageResponseMutation.isLoading,
    revokePausedMessage: revokePausedMessageMutation.mutate,
    isRevokingPausedMessage: revokePausedMessageMutation.isLoading,
    inviteAgent: inviteMutation.mutate,
  };
};
