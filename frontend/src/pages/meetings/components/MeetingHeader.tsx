import React from 'react';
import { MeetingStatus } from '../../../services/meetingService';
import { MeetingHeaderProps } from '../types';

const MeetingHeader: React.FC<MeetingHeaderProps> = ({
  meeting,
  displayDescription,
  speakingModeLabel,
  onSpeakingModeChange,
  isUpdatingSpeakingMode,
}) => {
  return (
    <div>
      {displayDescription && <p className="text-sm text-gray-500">{displayDescription}</p>}
      {meeting.agenda && (
        <p className="text-sm text-gray-600 mt-1">
          <span className="font-medium">议程：</span>
          {meeting.agenda}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-gray-500">发言模式:</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
          {speakingModeLabel}
        </span>
        {meeting.status !== MeetingStatus.ENDED && meeting.status !== MeetingStatus.ARCHIVED && (
          <>
            <button
              onClick={() => onSpeakingModeChange('free')}
              disabled={isUpdatingSpeakingMode || speakingModeLabel === '自由讨论'}
              className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              自由讨论
            </button>
            <button
              onClick={() => onSpeakingModeChange('ordered')}
              disabled={isUpdatingSpeakingMode || speakingModeLabel === '有序发言'}
              className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              有序发言
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default MeetingHeader;
