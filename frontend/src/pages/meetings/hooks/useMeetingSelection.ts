import { useCallback, useEffect, useMemo, useState } from 'react';
import { Meeting } from '../../../services/meetingService';

type Params = {
  meetingIdFromPath?: string;
  meetingIdFromSearch?: string | null;
};

export const useMeetingSelection = ({ meetingIdFromPath, meetingIdFromSearch }: Params) => {
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [pinnedMeetingId, setPinnedMeetingId] = useState<string | null>(null);

  const mergeMeetingSnapshot = useCallback((current: Meeting, incoming: Meeting): Meeting => {
    const currentMessages = Array.isArray(current.messages) ? current.messages : [];
    const incomingMessages = Array.isArray(incoming.messages) ? incoming.messages : [];

    const mergedMessages = incomingMessages.length >= currentMessages.length ? incomingMessages : currentMessages;
    const mergedSummary = incoming.summary || current.summary;
    const mergedMessageCount = Math.max(current.messageCount || 0, incoming.messageCount || 0, mergedMessages.length);

    const next: Meeting = {
      ...current,
      ...incoming,
      messages: mergedMessages,
      summary: mergedSummary,
      messageCount: mergedMessageCount,
    };

    const unchanged =
      current.updatedAt === next.updatedAt &&
      current.status === next.status &&
      current.title === next.title &&
      (current.messages || []).length === (next.messages || []).length &&
      current.messageCount === next.messageCount &&
      current.summary?.generatedAt === next.summary?.generatedAt &&
      current.summary?.content === next.summary?.content;

    return unchanged ? current : next;
  }, []);

  const targetMeetingId = meetingIdFromPath || meetingIdFromSearch;
  const effectiveMeetingId = useMemo(() => pinnedMeetingId || targetMeetingId || null, [pinnedMeetingId, targetMeetingId]);

  useEffect(() => {
    if (!targetMeetingId) {
      return;
    }
    setPinnedMeetingId(targetMeetingId);
  }, [targetMeetingId]);

  const syncSelectedFromMeetings = useCallback(
    (meetings: Meeting[]) => {
      const meetingId = effectiveMeetingId;
      if (!meetingId || !meetings || meetings.length === 0) {
        return;
      }

      const matchedMeeting = meetings.find((meeting) => meeting.id === meetingId);
      if (matchedMeeting) {
        setSelectedMeeting((current) => {
          if (!current || current.id !== matchedMeeting.id) {
            return matchedMeeting;
          }
          return mergeMeetingSnapshot(current, matchedMeeting);
        });
        return;
      }
      setSelectedMeeting(null);
    },
    [effectiveMeetingId, mergeMeetingSnapshot],
  );

  const syncSelectedFromTargetMeeting = useCallback(
    (targetMeeting?: Meeting) => {
      if (!effectiveMeetingId || !targetMeeting) {
        return;
      }

      setSelectedMeeting((current) => {
        if (!current || current.id !== targetMeeting.id) {
          return targetMeeting;
        }
        return mergeMeetingSnapshot(current, targetMeeting);
      });
    },
    [effectiveMeetingId, mergeMeetingSnapshot],
  );

  return {
    selectedMeeting,
    setSelectedMeeting,
    pinnedMeetingId,
    setPinnedMeetingId,
    targetMeetingId,
    effectiveMeetingId,
    syncSelectedFromMeetings,
    syncSelectedFromTargetMeeting,
  };
};
