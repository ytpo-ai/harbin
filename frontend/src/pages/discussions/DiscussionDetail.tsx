import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowPathIcon, ChevronLeftIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import MessageBubble from '../../components/discussion/MessageBubble';
import MessageInput from '../../components/discussion/MessageInput';
import ThreadTree from '../../components/discussion/ThreadTree';
import SedimentPanel from '../../components/discussion/SedimentPanel';
import KnowledgePanel from '../../components/discussion/KnowledgePanel';
import ParticipantPanel from '../../components/discussion/ParticipantPanel';
import { authService, CurrentUser } from '../../services/authService';
import {
  discussionService,
  DiscussionMessage,
  DiscussionParticipant,
} from '../../services/discussionService';
import { DiscussionRightPanelTab, useDiscussionStore } from '../../stores/discussionStore';

const rightTabLabel: Record<DiscussionRightPanelTab, string> = {
  sediment: '文档沉淀',
  knowledge: '知识库',
  participants: '参与者',
};

const DiscussionDetail: React.FC = () => {
  const { spaceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [messageText, setMessageText] = useState('');
  const [actionError, setActionError] = useState('');

  const selectedThreadId = useDiscussionStore((state) => state.selectedThreadBySpace[spaceId] || '');
  const setSelectedThread = useDiscussionStore((state) => state.setSelectedThread);
  const rightPanelTab = useDiscussionStore((state) => state.rightPanelTabBySpace[spaceId] || 'sediment');
  const setRightPanelTab = useDiscussionStore((state) => state.setRightPanelTab);
  const knowledgeKeyword = useDiscussionStore((state) => state.knowledgeKeywordBySpace[spaceId] || '');
  const setKnowledgeKeyword = useDiscussionStore((state) => state.setKnowledgeKeyword);

  useEffect(() => {
    const loadUser = async () => {
      const user = await authService.getCurrentUser();
      setCurrentUser(user);
    };

    void loadUser();
  }, []);

  const detailQuery = useQuery(['discussion-space-detail', spaceId], () => discussionService.getSpaceDetail(spaceId), {
    enabled: Boolean(spaceId),
  });

  const selectedThread = useMemo(() => {
    const threads = detailQuery.data?.threadTree || [];
    return threads.find((item) => item.id === selectedThreadId);
  }, [detailQuery.data?.threadTree, selectedThreadId]);

  useEffect(() => {
    if (!detailQuery.data) {
      return;
    }

    if (selectedThreadId && detailQuery.data.threadTree.some((thread) => thread.id === selectedThreadId)) {
      return;
    }

    const fallbackThreadId = detailQuery.data.rootThreadId || detailQuery.data.threadTree[0]?.id;
    if (fallbackThreadId) {
      setSelectedThread(spaceId, fallbackThreadId);
    }
  }, [detailQuery.data, selectedThreadId, setSelectedThread, spaceId]);

  const messagesQuery = useQuery(
    ['discussion-messages', spaceId, selectedThreadId],
    () => discussionService.listMessages(spaceId, selectedThreadId, 200),
    {
      enabled: Boolean(spaceId && selectedThreadId),
      staleTime: 3_000,
    },
  );

  const knowledgeQuery = useQuery(
    ['discussion-knowledge', spaceId, selectedThreadId, knowledgeKeyword],
    () =>
      discussionService.listKnowledge(spaceId, {
        threadId: selectedThreadId || undefined,
        keyword: knowledgeKeyword.trim() || undefined,
      }),
    {
      enabled: Boolean(spaceId),
      staleTime: 15_000,
    },
  );

  const latestSedimentQuery = useQuery(['discussion-sediment-latest', spaceId], () => discussionService.getLatestSediment(spaceId), {
    enabled: Boolean(spaceId),
    staleTime: 5_000,
  });

  const participants = detailQuery.data?.participants || [];
  const participantMap = useMemo(
    () => Object.fromEntries(participants.map((participant) => [participant.id, participant])),
    [participants],
  );

  const currentParticipant = useMemo(() => {
    if (!participants.length) {
      return undefined;
    }
    if (currentUser?.id) {
      const userParticipant = participants.find((participant) => participant.userId === currentUser.id);
      if (userParticipant) {
        return userParticipant;
      }
    }
    return participants.find((participant) => participant.type === 'human') || participants[0];
  }, [currentUser?.id, participants]);

  const sendMessageMutation = useMutation(
    async () => {
      if (!selectedThreadId || !currentParticipant || !messageText.trim()) {
        return;
      }

      await discussionService.sendMessage(spaceId, selectedThreadId, {
        participantId: currentParticipant.id,
        senderType: 'user',
        content: messageText.trim(),
      });
    },
    {
      onSuccess: async () => {
        setMessageText('');
        setActionError('');
        await Promise.all([
          queryClient.invalidateQueries(['discussion-messages', spaceId, selectedThreadId]),
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
          queryClient.invalidateQueries(['discussion-sediment-latest', spaceId]),
        ]);
      },
      onError: () => {
        setActionError('消息发送失败，请稍后重试');
      },
    },
  );

  const branchMutation = useMutation(
    async ({ message, title }: { message: DiscussionMessage; title: string }) => {
      if (!selectedThreadId) {
        return;
      }
      return discussionService.branchFromMessage(spaceId, selectedThreadId, message.id, {
        title,
        contextSummary: message.content.slice(0, 300),
        branchOrigin: 'user',
      });
    },
    {
      onSuccess: async (thread) => {
        if (!thread) {
          return;
        }
        await queryClient.invalidateQueries(['discussion-space-detail', spaceId]);
        setSelectedThread(spaceId, thread.id);
        setActionError('');
      },
      onError: () => {
        setActionError('分叉失败，请稍后重试');
      },
    },
  );

  const sedimentModeMutation = useMutation(
    async (mode: 'manual' | 'realtime') => {
      return discussionService.updateSedimentMode(spaceId, mode);
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries(['discussion-space-detail', spaceId]);
      },
      onError: () => {
        setActionError('更新沉淀模式失败');
      },
    },
  );

  const generateSedimentMutation = useMutation(
    async () => discussionService.generateSediment(spaceId, selectedThreadId ? [selectedThreadId] : undefined),
    {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
          queryClient.invalidateQueries(['discussion-sediment-latest', spaceId]),
        ]);
        setActionError('');
      },
      onError: () => {
        setActionError('沉淀失败，请稍后重试');
      },
    },
  );

  const handleBranch = (message: DiscussionMessage) => {
    const title = window.prompt('请输入新讨论线标题');
    if (!title || !title.trim()) {
      return;
    }
    branchMutation.mutate({ message, title: title.trim() });
  };

  const sortedMessages = useMemo(() => {
    return [...(messagesQuery.data || [])].sort((a, b) => a.sequence - b.sequence);
  }, [messagesQuery.data]);

  if (detailQuery.isLoading) {
    return <div className="p-6 text-sm text-[#6f6f6f]">加载讨论空间中...</div>;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="p-6">
        <div className="text-sm text-[#da1e28]">加载失败，请稍后重试。</div>
        <button
          type="button"
          onClick={() => navigate('/discussions')}
          className="mt-3 border border-[#c6c6c6] px-3 py-2 text-sm text-[#262626] hover:bg-[#f4f4f4]"
        >
          返回讨论空间列表
        </button>
      </div>
    );
  }

  const detail = detailQuery.data;

  return (
    <div className="h-[calc(100vh-48px)] bg-[#ffffff] font-['IBM_Plex_Sans','Helvetica_Neue',Arial,sans-serif]">
      <div className="flex h-full flex-col">
        <div className="border-b border-[#c6c6c6] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/discussions')}
                className="inline-flex items-center gap-1 border border-[#c6c6c6] px-2 py-1 text-xs text-[#262626] hover:bg-[#f4f4f4]"
              >
                <ChevronLeftIcon className="h-3.5 w-3.5" />
                返回
              </button>
              <div>
                <h1 className="text-lg font-medium text-[#161616]">{detail.title}</h1>
                <p className="text-xs text-[#6f6f6f]">{detail.description || '暂无描述'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void Promise.all([detailQuery.refetch(), messagesQuery.refetch(), knowledgeQuery.refetch(), latestSedimentQuery.refetch()]);
              }}
              className="inline-flex items-center gap-1 border border-[#c6c6c6] px-3 py-2 text-xs text-[#262626] hover:bg-[#f4f4f4]"
            >
              <ArrowPathIcon className="h-4 w-4" />
              刷新
            </button>
          </div>
        </div>

        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
          <aside className="border-r border-[#c6c6c6] bg-[#f4f4f4] p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-[#161616]">讨论线</div>
              <span className="text-xs text-[#6f6f6f]">{detail.threadTree.length}</span>
            </div>
            <div className="max-h-[calc(100vh-190px)] overflow-auto pr-1">
              <ThreadTree
                threads={detail.threadTree}
                selectedThreadId={selectedThreadId}
                onSelect={(threadId) => setSelectedThread(spaceId, threadId)}
              />
            </div>
          </aside>

          <main className="flex min-h-0 flex-col border-r border-[#c6c6c6]">
            <div className="flex items-center justify-between border-b border-[#e0e0e0] px-4 py-2">
              <div className="text-sm text-[#262626]">
                当前讨论线：<span className="font-medium text-[#161616]">{selectedThread?.title || '未选择'}</span>
              </div>
              <div className="text-xs text-[#6f6f6f]">消息 {selectedThread?.messageCount || 0}</div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-[#ffffff] px-4 py-4">
              {messagesQuery.isLoading ? <div className="text-sm text-[#6f6f6f]">加载消息中...</div> : null}
              {!messagesQuery.isLoading && sortedMessages.length === 0 ? (
                <div className="border border-dashed border-[#c6c6c6] bg-[#f4f4f4] p-6 text-sm text-[#6f6f6f]">该讨论线暂无消息</div>
              ) : null}
              {sortedMessages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  participant={participantMap[message.participantId] as DiscussionParticipant | undefined}
                  onBranch={handleBranch}
                />
              ))}
            </div>

            <MessageInput
              value={messageText}
              sending={sendMessageMutation.isLoading}
              participants={participants}
              onChange={setMessageText}
              onSend={() => {
                if (!selectedThreadId) {
                  setActionError('请先选择讨论线');
                  return;
                }
                if (!currentParticipant) {
                  setActionError('当前空间暂无可用参与者，无法发送消息');
                  return;
                }
                sendMessageMutation.mutate();
              }}
            />
          </main>

          <aside className="min-h-0 bg-[#f4f4f4] p-3">
            <div className="mb-3 grid grid-cols-3 border border-[#c6c6c6] bg-white">
              {(Object.keys(rightTabLabel) as DiscussionRightPanelTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setRightPanelTab(spaceId, tab)}
                  className={`border-r border-[#e0e0e0] px-2 py-2 text-xs last:border-r-0 ${
                    rightPanelTab === tab ? 'bg-[#edf5ff] text-[#0f62fe]' : 'text-[#525252] hover:bg-[#f4f4f4]'
                  }`}
                >
                  {rightTabLabel[tab]}
                </button>
              ))}
            </div>

            <div className="max-h-[calc(100vh-190px)] overflow-auto pr-1">
              {rightPanelTab === 'sediment' ? (
                <SedimentPanel
                  mode={detail.sedimentMode}
                  latestContent={latestSedimentQuery.data?.latest?.content || detail.latestSedimentedDocument}
                  latestCreatedAt={latestSedimentQuery.data?.latest?.createdAt}
                  generating={generateSedimentMutation.isLoading}
                  updatingMode={sedimentModeMutation.isLoading}
                  onChangeMode={(mode) => sedimentModeMutation.mutate(mode)}
                  onGenerate={() => generateSedimentMutation.mutate()}
                />
              ) : null}

              {rightPanelTab === 'knowledge' ? (
                <KnowledgePanel
                  keyword={knowledgeKeyword}
                  loading={knowledgeQuery.isLoading}
                  items={knowledgeQuery.data || []}
                  onKeywordChange={(value) => setKnowledgeKeyword(spaceId, value)}
                />
              ) : null}

              {rightPanelTab === 'participants' ? <ParticipantPanel participants={participants} /> : null}
            </div>
          </aside>
        </div>

        {actionError ? (
          <div className="border-t border-[#da1e28] bg-[#fff1f1] px-4 py-2 text-xs text-[#da1e28]">
            <div className="inline-flex items-center gap-1">
              <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
              {actionError}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default DiscussionDetail;
