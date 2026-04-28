import React from 'react';
import { DiscussionParticipant } from '../../services/discussionService';

type ParticipantPanelProps = {
  participants: DiscussionParticipant[];
};

const presenceColor: Record<DiscussionParticipant['presence'], string> = {
  online: 'bg-[#24a148]',
  idle: 'bg-[#f1c21b]',
  offline: 'bg-[#8d8d8d]',
};

const ParticipantPanel: React.FC<ParticipantPanelProps> = ({ participants }) => {
  return (
    <div className="border border-[#c6c6c6] bg-white p-4">
      <div className="mb-3 text-sm font-medium text-[#161616]">参与者 ({participants.length})</div>
      {participants.length === 0 ? <div className="text-sm text-[#6f6f6f]">暂无参与者</div> : null}
      <div className="space-y-2">
        {participants.map((participant) => (
          <div key={participant.id} className="flex items-start justify-between border border-[#e0e0e0] bg-[#f4f4f4] p-3">
            <div>
              <div className="text-sm text-[#161616]">{participant.displayName}</div>
              <div className="mt-1 text-xs text-[#6f6f6f]">
                {participant.type === 'human' ? '真人' : 'AI Agent'} · {participant.role === 'primary' ? '主参与者' : '按需参与'}
              </div>
              {participant.expertise ? <div className="mt-1 text-xs text-[#525252]">{participant.expertise}</div> : null}
            </div>
            <span className={`mt-1 inline-block h-2.5 w-2.5 ${presenceColor[participant.presence]}`} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ParticipantPanel;
