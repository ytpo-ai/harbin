import { useCallback, useEffect, useMemo, useState } from 'react';
import { Meeting } from '../../../services/meetingService';

type Params = {
  meetingIdFromPath?: string;
  meetingIdFromSearch?: string | null;
};

export const useMeetingSelection = ({ meetingIdFromPath, meetingIdFromSearch }: Params) => {
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [pinnedMeetingId, setPinnedMeetingId] = useState<string | null>(null);

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

      if (selectedMeeting?.id === meetingId) {
        return;
      }

      const matchedMeeting = meetings.find((meeting) => meeting.id === meetingId);
      if (matchedMeeting) {
        setSelectedMeeting(matchedMeeting);
        return;
      }
      setSelectedMeeting(null);
    },
    [effectiveMeetingId, selectedMeeting?.id],
  );

  const syncSelectedFromTargetMeeting = useCallback(
    (targetMeeting?: Meeting) => {
      if (!effectiveMeetingId || !targetMeeting) {
        return;
      }

      if (selectedMeeting?.id === targetMeeting.id) {
        return;
      }

      setSelectedMeeting(targetMeeting);
    },
    [effectiveMeetingId, selectedMeeting?.id],
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
