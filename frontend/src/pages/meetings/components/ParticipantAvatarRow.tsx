import React from 'react';
import { UserPlusIcon } from '@heroicons/react/24/outline';
import { MeetingStatus } from '../../../services/meetingService';
import { ParticipantAvatarRowProps } from '../types';

const ParticipantAvatarRow: React.FC<ParticipantAvatarRowProps> = ({
  meeting,
  thinkingAgentIds,
  agents,
  getParticipantDisplayName,
  onInviteAgent,
}) => {
  const availableAgents = agents.filter(
    (agent) =>
      agent.isActive &&
      !(meeting.participants || []).some((participant) => participant.agentId === agent.id || participant.participantId === agent.id) &&
      !(meeting.invitedAgentIds || []).includes(agent.id!),
  );

  return (
    <div className="mt-4 flex items-center gap-2">
      <span className="text-sm text-gray-500">参与者：</span>
      <div className="flex items-center gap-1">
        {(meeting.participants || []).map((participant) => {
          const legacyParticipant = participant as any;
          const participantId = participant.participantId || legacyParticipant.agentId || 'unknown';
          const participantName = getParticipantDisplayName(participantId, participant.participantType, participant);
          const isAgentThinking =
            participant.participantType === 'agent' && participant.isPresent && thinkingAgentIds.includes(participantId);

          return (
            <div
              key={participantId}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 ${
                participant.isPresent ? 'bg-green-500 text-white border-green-500' : 'bg-gray-200 text-gray-600 border-gray-300'
              } ${isAgentThinking ? 'ring-2 ring-amber-300 shadow-sm shadow-amber-100 animate-pulse relative' : ''}`}
              title={`${participantName} ${participant.isPresent ? '(在线)' : '(离线)'}${isAgentThinking ? ' (思考中)' : ''}`}
            >
              {participantName.charAt(0).toUpperCase()}
              {isAgentThinking && (
                <>
                  <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full bg-amber-400 animate-ping"></span>
                  <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full bg-amber-500 border border-white"></span>
                </>
              )}
            </div>
          );
        })}

        {meeting.status !== MeetingStatus.ENDED && (
          <div className="relative group">
            <button className="w-8 h-8 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:border-gray-400">
              <UserPlusIcon className="h-4 w-4" />
            </button>

            <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10 hidden group-hover:block">
              <div className="p-2 max-h-48 overflow-y-auto">
                <p className="text-xs text-gray-500 mb-2 px-2">点击邀请Agent</p>
                {availableAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => onInviteAgent(agent.id!)}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 rounded flex items-center"
                  >
                    <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs mr-2">
                      {agent.name.charAt(0)}
                    </div>
                    {agent.name}
                  </button>
                ))}
                {availableAgents.length === 0 && <p className="text-xs text-gray-400 px-2 py-1">没有可邀请的Agent</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      {(meeting.invitedAgentIds || []).length > 0 && (
        <span className="text-xs text-gray-400 ml-2">+{(meeting.invitedAgentIds || []).length} 已邀请</span>
      )}
    </div>
  );
};

export default ParticipantAvatarRow;
