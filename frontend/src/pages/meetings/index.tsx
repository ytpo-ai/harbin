import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { useQueryClient } from 'react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { Meeting, MeetingStatus } from '../../services/meetingService';
import ChatInput from './components/ChatInput';
import CreateMeetingModal from './components/CreateMeetingModal';
import MeetingHeader from './components/MeetingHeader';
import MeetingListSidebar from './components/MeetingListSidebar';
import MeetingStatusActions from './components/MeetingStatusActions';
import MessageList from './components/MessageList';
import MeetingSummaryPanel from './components/MeetingSummaryPanel';
import OperationsSidebar from './components/OperationsSidebar';
import ParticipantAvatarRow from './components/ParticipantAvatarRow';
import { MEETING_PHRASE_SUGGESTIONS } from './constants';
import { useMeetingMutations } from './hooks/useMeetingMutations';
import { useMeetingQueries } from './hooks/useMeetingQueries';
import { useMeetingRealtime } from './hooks/useMeetingRealtime';
import { useMeetingSelection } from './hooks/useMeetingSelection';
import { useMentionAutocomplete } from './hooks/useMentionAutocomplete';
import { useMessageHistory } from './hooks/useMessageHistory';
import { usePhraseAutocomplete } from './hooks/usePhraseAutocomplete';
import { MentionCandidate } from './types';
import {
  getMeetingDisplayDescription,
  getMeetingDisplayTitle,
  getMeetingTypeInfo,
  getParticipantDisplayName,
  getSpeakingModeLabel,
  getStatusBadge,
} from './utils';

const Meetings: React.FC = () => {
  const queryClient = useQueryClient();
  const { meetingId: meetingIdFromPath } = useParams<{ meetingId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [selectedCandidateKey, setSelectedCandidateKey] = useState('');
  const [isOperationsCollapsed, setIsOperationsCollapsed] = useState(true);
  const [thinkingAgentIds, setThinkingAgentIds] = useState<string[]>([]);
  const [showOperationMenu, setShowOperationMenu] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const isChatOnlyMode = Boolean(meetingIdFromPath);

  const {
    selectedMeeting,
    setSelectedMeeting,
    setPinnedMeetingId,
    effectiveMeetingId,
    syncSelectedFromMeetings,
    syncSelectedFromTargetMeeting,
  } = useMeetingSelection({
    meetingIdFromPath,
    meetingIdFromSearch: searchParams.get('meetingId'),
  });

  const {
    currentUser,
    meetings,
    meetingsLoading,
    stats,
    agents,
    targetMeeting,
    meetingAgentStates,
    participantDisplayMap,
    managementCandidates,
  } = useMeetingQueries({
    effectiveMeetingId,
    selectedMeeting,
  });

  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (!selectedMeeting) {
      return [];
    }

    const unique = new Map<string, MentionCandidate>();
    (selectedMeeting.participants || []).forEach((participant) => {
      const key = `${participant.participantType}:${participant.participantId}`;
      const name = participantDisplayMap.get(key) || participant.participantId;
      unique.set(key, {
        id: participant.participantId,
        type: participant.participantType,
        name,
      });
    });
    return Array.from(unique.values());
  }, [participantDisplayMap, selectedMeeting]);

  const mentionHook = useMentionAutocomplete({ mentionCandidates });
  const phraseHook = usePhraseAutocomplete({ phraseSuggestions: MEETING_PHRASE_SUGGESTIONS });
  const historyHook = useMessageHistory({ selectedMeeting, currentUserId: currentUser?.id });

  const repliedMessageIds = useMemo(() => {
    const replied = new Set<string>();
    (selectedMeeting?.messages || []).forEach((message) => {
      const relatedMessageId = message.metadata?.relatedMessageId;
      if (message.senderType === 'agent' && relatedMessageId) {
        replied.add(relatedMessageId);
      }
    });
    return replied;
  }, [selectedMeeting?.messages]);

  const mutations = useMeetingMutations({
    selectedMeeting,
    setSelectedMeeting,
    setIsCreateModalOpen,
    currentUser,
    participantDisplayMap,
    setNewMessage,
    resetMessageHistoryState: historyHook.resetHistoryState,
  });

  useMeetingRealtime({
    meetingId: selectedMeeting?.id,
    queryClient,
    setSelectedMeeting,
    setThinkingAgentIds,
  });

  useEffect(() => {
    const handleClickOutside = () => setShowOperationMenu(null);
    if (showOperationMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showOperationMenu]);

  useEffect(() => {
    syncSelectedFromMeetings(meetings);
  }, [meetings, syncSelectedFromMeetings]);

  useEffect(() => {
    syncSelectedFromTargetMeeting(targetMeeting);
  }, [syncSelectedFromTargetMeeting, targetMeeting]);

  useEffect(() => {
    setTitleDraft(selectedMeeting?.title || '');
  }, [selectedMeeting?.id, selectedMeeting?.title]);

  useEffect(() => {
    if (!selectedCandidateKey && managementCandidates.length > 0) {
      setSelectedCandidateKey(managementCandidates[0].key);
      return;
    }

    if (selectedCandidateKey && !managementCandidates.some((candidate) => candidate.key === selectedCandidateKey)) {
      setSelectedCandidateKey(managementCandidates[0]?.key || '');
    }
  }, [managementCandidates, selectedCandidateKey]);

  useEffect(() => {
    if (selectedMeeting) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedMeeting?.messages]);

  useEffect(() => {
    setThinkingAgentIds([]);
  }, [selectedMeeting?.id]);

  useEffect(() => {
    if (selectedMeeting?.status !== MeetingStatus.ACTIVE) {
      setThinkingAgentIds([]);
    }
  }, [selectedMeeting?.status]);

  useEffect(() => {
    if (!meetingAgentStates) {
      return;
    }

    setThinkingAgentIds(meetingAgentStates.filter((item) => item.state === 'thinking').map((item) => item.agentId));
  }, [meetingAgentStates]);

  const participantNameResolver = (
    participantId: string,
    participantType: 'employee' | 'agent',
    participant?: Meeting['participants'][number],
  ) => getParticipantDisplayName(participantDisplayMap, selectedMeeting, participantId, participantType, participant);

  const displayMeetingTitle = useMemo(
    () => getMeetingDisplayTitle(selectedMeeting?.title, selectedMeeting?.description),
    [selectedMeeting?.description, selectedMeeting?.title],
  );

  const displayMeetingDescription = useMemo(
    () => getMeetingDisplayDescription(displayMeetingTitle, selectedMeeting?.description),
    [displayMeetingTitle, selectedMeeting?.description],
  );

  if (meetingsLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className={isChatOnlyMode ? 'h-screen flex bg-gray-50' : 'h-[calc(100vh-6rem)] flex'}>
      {!isChatOnlyMode && (
        <MeetingListSidebar
          meetings={meetings}
          stats={stats}
          selectedMeetingId={selectedMeeting?.id}
          onCreateClick={() => setIsCreateModalOpen(true)}
          onSelectMeeting={(meeting) => {
            setPinnedMeetingId(meeting.id);
            setSelectedMeeting(meeting);
            if (!isChatOnlyMode && searchParams.get('meetingId')) {
              setSearchParams({}, { replace: true });
            }
          }}
          getMeetingTypeInfo={getMeetingTypeInfo}
          getMeetingDisplayTitle={getMeetingDisplayTitle}
          getStatusBadge={getStatusBadge}
        />
      )}

      <div className="flex-1 bg-gray-50 flex flex-col min-w-0">
        {selectedMeeting ? (
          <>
            <div className="bg-white border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-semibold text-gray-900">{displayMeetingTitle}</h2>
                    {getStatusBadge(selectedMeeting.status)}
                  </div>
                  <MeetingHeader
                    meeting={selectedMeeting}
                    displayDescription={displayMeetingDescription}
                    speakingModeLabel={getSpeakingModeLabel(selectedMeeting.settings?.speakingOrder)}
                    onSpeakingModeChange={(speakingOrder) => mutations.updateSpeakingMode({ id: selectedMeeting.id, speakingOrder })}
                    isUpdatingSpeakingMode={mutations.isUpdatingSpeakingMode}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <MeetingStatusActions
                    meeting={selectedMeeting}
                    currentUser={currentUser}
                    showOperationMenu={showOperationMenu}
                    setShowOperationMenu={setShowOperationMenu}
                    mutations={mutations}
                  />
                  <button
                    onClick={() => setIsOperationsCollapsed((prev) => !prev)}
                    className="inline-flex items-center justify-center h-9 w-9 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
                    title={isOperationsCollapsed ? '展开操作区' : '折叠操作区'}
                    aria-label={isOperationsCollapsed ? '展开操作区' : '折叠操作区'}
                  >
                    {isOperationsCollapsed ? <ChevronLeftIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <ParticipantAvatarRow
                meeting={selectedMeeting}
                thinkingAgentIds={thinkingAgentIds}
                agents={agents}
                getParticipantDisplayName={participantNameResolver}
                onInviteAgent={(agentId) =>
                  mutations.inviteAgent({
                    id: selectedMeeting.id,
                    agentId,
                    invitedBy: selectedMeeting.hostId,
                  })
                }
              />
            </div>

            <div className="flex-1 min-h-0 flex">
              <div className="flex-1 min-h-0 flex flex-col">
                <MessageList
                  meeting={selectedMeeting}
                  currentUser={currentUser}
                  repliedMessageIds={repliedMessageIds}
                  getParticipantDisplayName={participantNameResolver}
                  onPauseMessageResponse={(messageId) => {
                    if (!currentUser?.id) {
                      return;
                    }
                    mutations.pauseMessageResponse({
                      id: selectedMeeting.id,
                      messageId,
                      employeeId: currentUser.id,
                    });
                  }}
                  onRevokePausedMessage={(messageId) => {
                    if (!currentUser?.id) {
                      return;
                    }
                    mutations.revokePausedMessage({
                      id: selectedMeeting.id,
                      messageId,
                      employeeId: currentUser.id,
                    });
                  }}
                  isPausingMessageResponse={mutations.isPausingMessageResponse}
                  isRevokingPausedMessage={mutations.isRevokingPausedMessage}
                  messagesEndRef={messagesEndRef}
                />

                {selectedMeeting.status === MeetingStatus.ACTIVE && (
                  <ChatInput
                    meeting={selectedMeeting}
                    newMessage={newMessage}
                    setNewMessage={setNewMessage}
                    isComposing={isComposing}
                    setIsComposing={setIsComposing}
                    currentUserId={currentUser?.id}
                    mentionHook={mentionHook}
                    phraseHook={phraseHook}
                    historyHook={historyHook}
                    inputRef={messageInputRef}
                    isSendingMessage={mutations.isSendingMessage}
                    onSendMessage={(content) => mutations.sendMessage({ id: selectedMeeting.id, content })}
                  />
                )}

                {selectedMeeting.status === MeetingStatus.PAUSED && (
                  <div className="bg-white border-t border-gray-200 px-6 py-4 text-sm text-yellow-700">会议已暂停，恢复后可继续发言。</div>
                )}

                <MeetingSummaryPanel summary={selectedMeeting.summary} />
              </div>

              <OperationsSidebar
                meeting={selectedMeeting}
                isCollapsed={isOperationsCollapsed}
                titleDraft={titleDraft}
                setTitleDraft={setTitleDraft}
                managementCandidates={managementCandidates}
                selectedCandidateKey={selectedCandidateKey}
                setSelectedCandidateKey={setSelectedCandidateKey}
                getParticipantDisplayName={participantNameResolver}
                onSaveTitle={() => {
                  if (titleDraft.trim() && titleDraft.trim() !== selectedMeeting.title) {
                    mutations.updateMeetingTitle({ id: selectedMeeting.id, title: titleDraft.trim() });
                  }
                }}
                onAddParticipant={() => {
                  if (selectedCandidateKey) {
                    mutations.addParticipant({ id: selectedMeeting.id, candidateKey: selectedCandidateKey });
                  }
                }}
                onRemoveParticipant={(participantId, participantType) =>
                  mutations.removeParticipant({ id: selectedMeeting.id, participantId, participantType })
                }
                isUpdatingTitle={mutations.isUpdatingMeetingTitle}
                isAddingParticipant={mutations.isAddingParticipant}
                isRemovingParticipant={mutations.isRemovingParticipant}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <VideoCameraIcon className="h-16 w-16 mx-auto mb-4 text-gray-200" />
              {isChatOnlyMode ? (
                <>
                  <p className="text-lg">未找到该会议</p>
                  <p className="text-sm mt-1">请检查链接是否正确</p>
                </>
              ) : (
                <>
                  <p className="text-lg">选择一个会议开始</p>
                  <p className="text-sm mt-1">或创建新会议</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {!isChatOnlyMode && isCreateModalOpen && (
        <CreateMeetingModal
          agents={agents.filter((agent) => agent.isActive) || []}
          currentUser={currentUser}
          onClose={() => setIsCreateModalOpen(false)}
          onCreate={mutations.createMeeting}
          isLoading={mutations.isCreatingMeeting}
        />
      )}
    </div>
  );
};

export default Meetings;
