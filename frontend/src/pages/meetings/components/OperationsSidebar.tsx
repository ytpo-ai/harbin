import React from 'react';
import { OperationsSidebarProps } from '../types';

const OperationsSidebar: React.FC<OperationsSidebarProps> = ({
  meeting,
  isCollapsed,
  titleDraft,
  setTitleDraft,
  managementCandidates,
  selectedCandidateKey,
  setSelectedCandidateKey,
  getParticipantDisplayName,
  onSaveTitle,
  onAddParticipant,
  onRemoveParticipant,
  isUpdatingTitle,
  isAddingParticipant,
  isRemovingParticipant,
}) => {
  return (
    <aside className={`bg-white border-l border-gray-200 transition-all duration-200 ${isCollapsed ? 'w-12' : 'w-80'}`}>
      <div className="h-full flex flex-col">
        <div className="h-12 border-b border-gray-200 flex items-center px-2">
          {!isCollapsed && <h3 className="text-sm font-semibold text-gray-900">会议操作区</h3>}
        </div>

        {!isCollapsed && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-6">
              <p className="text-xs text-gray-500 mb-2">会议名称</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button
                  onClick={onSaveTitle}
                  disabled={isUpdatingTitle || !titleDraft.trim() || titleDraft.trim() === meeting.title}
                  className="px-3 py-2 rounded-md text-sm bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-2">参会人员管理</p>
              <div className="space-y-2 mb-3 max-h-72 overflow-y-auto pr-1">
                {(meeting.participants || []).map((participant) => {
                  const participantName = getParticipantDisplayName(participant.participantId, participant.participantType, participant);
                  const isHost = participant.participantId === meeting.hostId && participant.participantType === meeting.hostType;
                  return (
                    <div
                      key={`${participant.participantType}:${participant.participantId}`}
                      className="flex items-center justify-between text-sm border border-gray-200 rounded-md px-3 py-2"
                    >
                      <div>
                        <p className="font-medium text-gray-800">{participantName}</p>
                        <p className="text-xs text-gray-500">
                          {participant.participantType === 'agent' ? 'Agent' : '成员'}
                          {isHost ? ' · 主持人' : ''}
                        </p>
                      </div>
                      {!isHost && (
                        <button
                          onClick={() => onRemoveParticipant(participant.participantId, participant.participantType)}
                          disabled={isRemovingParticipant}
                          className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          移除
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="border border-dashed border-gray-300 rounded-md p-3">
                <p className="text-xs text-gray-500 mb-2">添加参会人员</p>
                <div className="flex gap-2">
                  <select
                    value={selectedCandidateKey}
                    onChange={(event) => setSelectedCandidateKey(event.target.value)}
                    className="flex-1 border border-gray-300 rounded-md px-2 py-2 text-sm"
                  >
                    {managementCandidates.length === 0 && <option value="">暂无可添加成员</option>}
                    {managementCandidates.map((candidate) => (
                      <option key={candidate.key} value={candidate.key}>
                        {candidate.name} ({candidate.type === 'agent' ? 'Agent' : '成员'})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={onAddParticipant}
                    disabled={isAddingParticipant || !selectedCandidateKey || managementCandidates.length === 0}
                    className="px-3 py-2 rounded-md text-sm bg-gray-900 text-white hover:bg-black disabled:opacity-50"
                  >
                    添加
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default OperationsSidebar;
