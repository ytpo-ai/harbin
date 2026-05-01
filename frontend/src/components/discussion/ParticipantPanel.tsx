import React from 'react';
import { DiscussionParticipant } from '../../services/discussionService';

type AgentOption = {
  id: string;
  name: string;
};

type ParticipantPanelProps = {
  participants: DiscussionParticipant[];
  availableAgents: AgentOption[];
  selectedAgentId: string;
  defaultReplyAgentId?: string;
  autoAnalysisOnDataUpdate?: boolean;
  addingAgent: boolean;
  updatingAutoAnalysis?: boolean;
  removingParticipantId?: string;
  onSelectAgent: (agentId: string) => void;
  onAddAgent: () => void;
  onDefaultReplyAgentChange: (participantId: string) => void;
  onAutoAnalysisOnDataUpdateChange: (enabled: boolean) => void;
  onRemoveParticipant: (participantId: string) => void;
};

const presenceColor: Record<DiscussionParticipant['presence'], string> = {
  online: 'bg-[#24a148]',
  idle: 'bg-[#f1c21b]',
  offline: 'bg-[#8d8d8d]',
};

const ParticipantPanel: React.FC<ParticipantPanelProps> = ({
  participants,
  availableAgents,
  selectedAgentId,
  defaultReplyAgentId,
  autoAnalysisOnDataUpdate,
  addingAgent,
  updatingAutoAnalysis = false,
  removingParticipantId,
  onSelectAgent,
  onAddAgent,
  onDefaultReplyAgentChange,
  onAutoAnalysisOnDataUpdateChange,
  onRemoveParticipant,
}) => {
  const existingAgentIds = new Set(participants.map((participant) => participant.agentId).filter(Boolean));
  const agentOptions = availableAgents.filter((agent) => !existingAgentIds.has(agent.id));
  const aiParticipants = participants.filter((participant) => participant.type === 'ai_agent');
  const defaultReplyAgent = aiParticipants.find((participant) => participant.id === defaultReplyAgentId);

  return (
    <div className="border border-[#c6c6c6] bg-white p-4">
      <div className="mb-3 text-sm font-medium text-[#161616]">参与者 ({participants.length})</div>

      <div className="mb-3 border border-[#e0e0e0] bg-[#f4f4f4] p-2">
        <div className="mb-2 text-xs text-[#6f6f6f]">默认回复 Agent</div>
        <select
          value={defaultReplyAgentId || ''}
          onChange={(event) => onDefaultReplyAgentChange(event.target.value)}
          className="w-full border border-[#c6c6c6] bg-white px-2 py-1.5 text-xs text-[#161616] outline-none focus:border-[#0f62fe]"
        >
          <option value="">不设置</option>
          {aiParticipants.map((participant) => (
            <option key={participant.id} value={participant.id}>
              {participant.displayName}
            </option>
          ))}
        </select>
        <div className="mt-2 text-[11px] text-[#8d8d8d]">
          {defaultReplyAgent ? `未显式 @ 时默认由 @${defaultReplyAgent.displayName} 回复` : '未显式 @ 时不会自动唤醒 Agent'}
        </div>
      </div>

      <div className="mb-3 border border-[#e0e0e0] bg-[#f4f4f4] p-2">
        <div className="mb-2 text-xs text-[#6f6f6f]">数据更新自动分析</div>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-xs text-[#525252]">变化超过阈值时自动发布分析消息</span>
          <input
            type="checkbox"
            checked={Boolean(autoAnalysisOnDataUpdate)}
            onChange={(event) => onAutoAnalysisOnDataUpdateChange(event.target.checked)}
            disabled={updatingAutoAnalysis}
            className="h-4 w-4"
          />
        </label>
        <div className="mt-2 text-[11px] text-[#8d8d8d]">
          {autoAnalysisOnDataUpdate
            ? '已开启：达到变化阈值后，系统会在讨论中自动发送分析提醒'
            : '已关闭：仅回灌知识，不自动创建分析消息'}
        </div>
      </div>

      <div className="mb-3 border border-[#e0e0e0] bg-[#f4f4f4] p-2">
        <div className="mb-2 text-xs text-[#6f6f6f]">添加 Agent</div>
        <div className="flex items-center gap-2">
          <select
            value={selectedAgentId}
            onChange={(event) => onSelectAgent(event.target.value)}
            className="min-w-0 flex-1 border border-[#c6c6c6] bg-white px-2 py-1.5 text-xs text-[#161616] outline-none focus:border-[#0f62fe]"
          >
            <option value="">请选择 Agent</option>
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onAddAgent}
            disabled={!selectedAgentId || addingAgent}
            className="border border-[#0f62fe] px-2 py-1.5 text-xs text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addingAgent ? '添加中...' : '添加'}
          </button>
        </div>
      </div>

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
            <div className="ml-3 flex items-start gap-2">
              <span className={`mt-1 inline-block h-2.5 w-2.5 ${presenceColor[participant.presence]}`} />
              {participant.type === 'ai_agent' ? (
                <button
                  type="button"
                  onClick={() => onRemoveParticipant(participant.id)}
                  disabled={removingParticipantId === participant.id}
                  className="border border-[#da1e28] px-2 py-0.5 text-xs text-[#da1e28] hover:bg-[#fff1f1] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {removingParticipantId === participant.id ? '移除中...' : '移除'}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ParticipantPanel;
