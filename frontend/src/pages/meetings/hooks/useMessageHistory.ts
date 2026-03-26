import { useEffect, useMemo, useState } from 'react';
import { Meeting } from '../../../services/meetingService';

type Params = {
  selectedMeeting: Meeting | null;
  currentUserId?: string;
};

export const useMessageHistory = ({ selectedMeeting, currentUserId }: Params) => {
  const [messageHistoryIndex, setMessageHistoryIndex] = useState<number | null>(null);
  const [messageHistoryDraft, setMessageHistoryDraft] = useState('');

  const sentMessageHistory = useMemo(() => {
    if (!selectedMeeting || !currentUserId) {
      return [];
    }

    return (selectedMeeting.messages || [])
      .filter((message) => {
        if (message.senderType === 'employee' && message.senderId === currentUserId) {
          return true;
        }

        const metadata = message.metadata;
        return message.senderType === 'agent' && metadata?.proxyForEmployeeId === currentUserId;
      })
      .map((message) => message.content?.trim() || '')
      .filter((content) => Boolean(content));
  }, [currentUserId, selectedMeeting]);

  useEffect(() => {
    setMessageHistoryIndex(null);
    setMessageHistoryDraft('');
  }, [selectedMeeting?.id]);

  const resetHistoryState = () => {
    setMessageHistoryIndex(null);
    setMessageHistoryDraft('');
  };

  const navigateUp = (currentDraft: string) => {
    if (!sentMessageHistory.length) {
      return currentDraft;
    }

    const nextIndex = messageHistoryIndex === null ? sentMessageHistory.length - 1 : Math.max(messageHistoryIndex - 1, 0);
    if (messageHistoryIndex === null) {
      setMessageHistoryDraft(currentDraft);
    }
    setMessageHistoryIndex(nextIndex);
    return sentMessageHistory[nextIndex] || '';
  };

  const navigateDown = () => {
    if (messageHistoryIndex === null) {
      return '';
    }

    if (messageHistoryIndex < sentMessageHistory.length - 1) {
      const nextIndex = messageHistoryIndex + 1;
      setMessageHistoryIndex(nextIndex);
      return sentMessageHistory[nextIndex] || '';
    }

    const draft = messageHistoryDraft;
    setMessageHistoryIndex(null);
    setMessageHistoryDraft('');
    return draft;
  };

  return {
    sentMessageHistory,
    messageHistoryIndex,
    resetHistoryState,
    navigateUp,
    navigateDown,
  };
};
