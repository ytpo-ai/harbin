import React from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { MeetingSummaryPanelProps } from '../types';

const MeetingSummaryPanel: React.FC<MeetingSummaryPanelProps> = ({ summary }) => {
  if (!summary) {
    return null;
  }

  return (
    <div className="bg-blue-50 border-t border-blue-200 px-6 py-4">
      <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center">
        <CheckCircleIcon className="h-4 w-4 mr-1" />
        会议总结
      </h3>
      <div className="text-sm text-blue-800 whitespace-pre-wrap">{summary.content}</div>
      {(summary.actionItems || []).length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-blue-900">行动项：</p>
          <ul className="text-xs text-blue-800 list-disc list-inside mt-1">
            {(summary.actionItems || []).map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default MeetingSummaryPanel;
