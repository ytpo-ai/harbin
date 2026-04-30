import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowPathIcon, ChevronLeftIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import MessageBubble from '../../components/discussion/MessageBubble';
import MessageInput from '../../components/discussion/MessageInput';
import ThreadTree from '../../components/discussion/ThreadTree';
import SedimentPanel from '../../components/discussion/SedimentPanel';
import OutlinePanel from '../../components/discussion/OutlinePanel';
import KnowledgePanel from '../../components/discussion/KnowledgePanel';
import ParticipantPanel from '../../components/discussion/ParticipantPanel';
import KnowledgeArchiveModal from '../../components/discussion/KnowledgeArchiveModal';
import MessageToRequirementModal from '../../components/discussion/MessageToRequirementModal';
import { engineeringIntelligenceService } from '../../services/engineeringIntelligenceService';
import { agentService } from '../../services/agentService';
import { authService, CurrentUser } from '../../services/authService';
import {
  discussionService,
  DiscussionMessage,
  DiscussionMessageStreamEvent,
  DiscussionParticipant,
  DiscussionSedimentTaskStreamEvent,
} from '../../services/discussionService';
import { DiscussionRightPanelTab, useDiscussionStore } from '../../stores/discussionStore';

const rightTabLabel: Record<DiscussionRightPanelTab, string> = {
  sediment: '文档沉淀',
  outline: '大纲',
  knowledge: '知识库',
  participants: '参与者',
};

const DiscussionDetail: React.FC = () => {
  const { spaceId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [messageText, setMessageText] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [isSedimentStreaming, setIsSedimentStreaming] = useState(false);
  const [archiveTargetMessage, setArchiveTargetMessage] = useState<DiscussionMessage | null>(null);
  const [archiveMode, setArchiveMode] = useState<'existing' | 'create'>('existing');
  const [archiveExistingKeyword, setArchiveExistingKeyword] = useState('');
  const [archiveSelectedKnowledgeEntryIds, setArchiveSelectedKnowledgeEntryIds] = useState<string[]>([]);
  const [archiveCreateTitle, setArchiveCreateTitle] = useState('');
  const [archiveCreateSummary, setArchiveCreateSummary] = useState('');
  const [archiveCreateContent, setArchiveCreateContent] = useState('');
  const [toRequirementMessage, setToRequirementMessage] = useState<DiscussionMessage | null>(null);
  const [toRequirementTitle, setToRequirementTitle] = useState('');
  const [toRequirementDescription, setToRequirementDescription] = useState('');
  const [toRequirementPriority, setToRequirementPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const sedimentTaskUnsubscribeRef = useRef<null | (() => void)>(null);
  const focusFromUrlDoneRef = useRef(false);

  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialThreadId = queryParams.get('threadId') || '';
  const initialMessageId = queryParams.get('messageId') || '';

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

    if (initialThreadId && detailQuery.data.threadTree.some((thread) => thread.id === initialThreadId)) {
      setSelectedThread(spaceId, initialThreadId);
      return;
    }

    if (selectedThreadId && detailQuery.data.threadTree.some((thread) => thread.id === selectedThreadId)) {
      return;
    }

    const fallbackThreadId = detailQuery.data.rootThreadId || detailQuery.data.threadTree[0]?.id;
    if (fallbackThreadId) {
      setSelectedThread(spaceId, fallbackThreadId);
    }
  }, [detailQuery.data, initialThreadId, selectedThreadId, setSelectedThread, spaceId]);

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

  const archiveKnowledgeOptionsQuery = useQuery(
    ['discussion-knowledge-options', spaceId, archiveExistingKeyword],
    () =>
      discussionService.listKnowledge(spaceId, {
        keyword: archiveExistingKeyword.trim() || undefined,
        limit: 100,
      }),
    {
      enabled: Boolean(spaceId && archiveTargetMessage && archiveMode === 'existing'),
      staleTime: 10_000,
    },
  );

  const latestSedimentQuery = useQuery(['discussion-sediment-latest', spaceId], () => discussionService.getLatestSediment(spaceId), {
    enabled: Boolean(spaceId),
    staleTime: 5_000,
  });

  const sedimentHistoryQuery = useQuery(['discussion-sediment-history', spaceId], () => discussionService.getSedimentHistory(spaceId, 20), {
    enabled: Boolean(spaceId),
    staleTime: 10_000,
  });

  const assignableAgentsQuery = useQuery(
    ['discussion-assignable-agents', detailQuery.data?.projectId || 'global'],
    () => agentService.getAssignableAgents(detailQuery.data?.projectId),
    {
      enabled: Boolean(spaceId),
      staleTime: 60_000,
    },
  );

  const participants = detailQuery.data?.participants || [];

  const outlineQuery = useQuery(['discussion-outline', spaceId], () => discussionService.getOutline(spaceId), {
    enabled: Boolean(spaceId),
    staleTime: 10_000,
  });

  const coverageQuery = useQuery(['discussion-knowledge-coverage', spaceId], () => discussionService.getKnowledgeCoverage(spaceId), {
    enabled: Boolean(spaceId),
    staleTime: 10_000,
  });
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

  const deleteThreadMutation = useMutation(
    async (thread: { id: string }) => {
      return discussionService.deleteThread(spaceId, thread.id);
    },
    {
      onSuccess: async (result) => {
        const removedSelectedThread = Boolean(selectedThreadId && result.deletedThreadIds.includes(selectedThreadId));
        await Promise.all([
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
          queryClient.invalidateQueries(['discussion-messages', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
        ]);
        if (removedSelectedThread) {
          const fallbackThreadId = detailQuery.data?.rootThreadId || detailQuery.data?.threadTree?.[0]?.id || '';
          if (fallbackThreadId) {
            setSelectedThread(spaceId, fallbackThreadId);
          }
        }
        setActionError('');
        setActionNotice('讨论线已删除');
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '删除讨论线失败')
            : '删除讨论线失败';
        setActionNotice('');
        setActionError(message);
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

  const startSedimentTaskStream = (taskId: string) => {
    sedimentTaskUnsubscribeRef.current?.();
    setIsSedimentStreaming(true);

    const stop = discussionService.subscribeSedimentTaskEvents(spaceId, taskId, {
      onEvent: (event: DiscussionSedimentTaskStreamEvent) => {
        const status = event.data.task?.status;
        if (!status) {
          return;
        }

        if (status === 'queued' || status === 'running') {
          setActionError('');
          setActionNotice('沉淀任务执行中，请稍候...');
          return;
        }

        if (status === 'succeeded') {
          setIsSedimentStreaming(false);
          sedimentTaskUnsubscribeRef.current?.();
          sedimentTaskUnsubscribeRef.current = null;
          setActionError('');
          setActionNotice('沉淀完成，已刷新最新文档与历史版本');
          void Promise.all([
            queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
            queryClient.invalidateQueries(['discussion-sediment-latest', spaceId]),
            queryClient.invalidateQueries(['discussion-sediment-history', spaceId]),
          ]);
          return;
        }

        if (status === 'failed') {
          setIsSedimentStreaming(false);
          sedimentTaskUnsubscribeRef.current?.();
          sedimentTaskUnsubscribeRef.current = null;
          setActionNotice('');
          setActionError(event.data.task?.error || '沉淀失败，请稍后重试');
        }
      },
      onError: () => {
        setIsSedimentStreaming(false);
        sedimentTaskUnsubscribeRef.current?.();
        sedimentTaskUnsubscribeRef.current = null;
        setActionError('沉淀任务连接中断，请重试');
      },
    });

    sedimentTaskUnsubscribeRef.current = stop;
  };

  const generateSedimentMutation = useMutation(
    async (sedimentTitle: string) =>
      discussionService.generateSediment(spaceId, {
        title: sedimentTitle,
        threadScope: selectedThreadId ? [selectedThreadId] : undefined,
      }),
    {
      onSuccess: (task) => {
        setActionError('');
        setActionNotice('沉淀任务已提交，正在连接结果流...');
        if (task?.taskId) {
          startSedimentTaskStream(task.taskId);
          return;
        }
        setActionError('沉淀任务创建失败，请稍后重试');
      },
      onError: () => {
        setActionError('沉淀任务创建失败，请稍后重试');
      },
    },
  );

  const generateOutlineMutation = useMutation(
    async () => {
      return discussionService.generateOutline(spaceId, {
        industryContext: detailQuery.data?.metadata?.industryContext,
      });
    },
    {
      onSuccess: async () => {
        setActionError('');
        setActionNotice('大纲已生成');
        await Promise.all([
          queryClient.invalidateQueries(['discussion-outline', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge-coverage', spaceId]),
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
        ]);
      },
      onError: () => {
        setActionError('生成大纲失败，请稍后重试');
      },
    },
  );

  const deleteSedimentHistoryMutation = useMutation(
    async (historyId: string) => {
      if (!currentUser?.id) {
        throw new Error('未获取到当前用户信息，无法删除历史沉淀');
      }
      return discussionService.deleteSedimentHistory(spaceId, historyId, currentUser.id);
    },
    {
      onSuccess: async () => {
        setActionError('');
        setActionNotice('沉淀历史已删除');
        await Promise.all([
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
          queryClient.invalidateQueries(['discussion-sediment-latest', spaceId]),
          queryClient.invalidateQueries(['discussion-sediment-history', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '删除沉淀历史失败')
            : '删除沉淀历史失败';
        setActionError(message);
      },
    },
  );

  const addParticipantMutation = useMutation(
    async () => {
      if (!selectedAgentId) {
        return;
      }

      const matchedAgent = (assignableAgentsQuery.data || []).find((agent) => agent.id === selectedAgentId);
      if (!matchedAgent) {
        throw new Error('未找到可添加的 Agent，请刷新后重试');
      }

      await discussionService.addParticipant(spaceId, {
        type: 'ai_agent',
        agentId: matchedAgent.id,
        displayName: matchedAgent.name,
        role: 'on_demand',
        expertise: matchedAgent.description || undefined,
        expertiseTags: matchedAgent.capabilities || [],
      });
    },
    {
      onSuccess: async () => {
        setSelectedAgentId('');
        setActionError('');
        await queryClient.invalidateQueries(['discussion-space-detail', spaceId]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '添加 Agent 失败')
            : '添加 Agent 失败';
        setActionError(message);
      },
    },
  );

  const removeParticipantMutation = useMutation(
    async (participantId: string) => {
      await discussionService.removeParticipant(spaceId, participantId);
    },
    {
      onSuccess: async () => {
        setActionError('');
        await queryClient.invalidateQueries(['discussion-space-detail', spaceId]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '移除参与者失败')
            : '移除参与者失败';
        setActionError(message);
      },
    },
  );

  const updateDefaultReplyAgentMutation = useMutation(
    async (participantId: string) => {
      const settings = {
        ...(detailQuery.data?.settings || {}),
      };
      if (participantId) {
        settings.defaultReplyAgentId = participantId;
      } else {
        delete settings.defaultReplyAgentId;
      }

      return discussionService.updateSpace(spaceId, { settings });
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries(['discussion-space-detail', spaceId]);
        setActionError('');
        setActionNotice('默认回复 Agent 已更新');
      },
      onError: () => {
        setActionError('更新默认回复 Agent 失败');
      },
    },
  );

  const archiveKnowledgeMutation = useMutation(
    async () => {
      if (!archiveTargetMessage) {
        throw new Error('未找到目标消息');
      }

      if (archiveMode === 'existing') {
        if (!archiveSelectedKnowledgeEntryIds.length) {
          throw new Error('请至少选择一个知识条目');
        }
        return discussionService.linkMessageKnowledge(
          spaceId,
          archiveTargetMessage.threadId,
          archiveTargetMessage.id,
          archiveSelectedKnowledgeEntryIds,
        );
      }

      if (!currentParticipant?.id) {
        throw new Error('当前空间暂无可用参与者，无法创建知识条目');
      }

      const title = archiveCreateTitle.trim();
      const content = archiveCreateContent.trim();
      if (!title) {
        throw new Error('知识标题不能为空');
      }
      if (!content) {
        throw new Error('知识内容不能为空');
      }

      const created = await discussionService.createKnowledge(spaceId, {
        participantId: currentParticipant.id,
        title,
        summary: archiveCreateSummary.trim() || undefined,
        content,
        sourceType: 'discussion_derived',
        sourceName: 'discussion-space',
        threadId: archiveTargetMessage.threadId,
        messageId: archiveTargetMessage.id,
      });

      return discussionService.linkMessageKnowledge(
        spaceId,
        archiveTargetMessage.threadId,
        archiveTargetMessage.id,
        [created.id],
      );
    },
    {
      onSuccess: async () => {
        setActionError('');
        setActionNotice('知识落档成功');
        setArchiveTargetMessage(null);
        setArchiveSelectedKnowledgeEntryIds([]);
        await Promise.all([
          queryClient.invalidateQueries(['discussion-messages', spaceId, selectedThreadId]),
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge-options', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '知识落档失败')
            : '知识落档失败';
        setActionNotice('');
        setActionError(message);
      },
    },
  );

  const toRequirementMutation = useMutation(
    async () => {
      if (!toRequirementMessage) {
        throw new Error('未找到目标消息');
      }

      const title = toRequirementTitle.trim();
      if (!title) {
        throw new Error('需求标题不能为空');
      }

      return discussionService.createRequirementFromMessage(
        spaceId,
        toRequirementMessage.threadId,
        toRequirementMessage.id,
        {
          title,
          description: toRequirementDescription.trim() || toRequirementMessage.content,
          priority: toRequirementPriority,
          projectId: detailQuery.data?.projectId,
          createdById: currentUser?.id,
          createdByName: currentUser?.name,
        },
      );
    },
    {
      onSuccess: (result) => {
        setActionError('');
        setActionNotice(`需求已创建：${result.requirementId}`);
        setToRequirementMessage(null);
        setToRequirementTitle('');
        setToRequirementDescription('');
        setToRequirementPriority('medium');
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '转需求失败')
            : '转需求失败';
        setActionError(message);
      },
    },
  );

  const knowledgeToRequirementMutation = useMutation(
    async (entry: {
      id: string;
      title: string;
      content: string;
      summary?: string;
      threadId?: string;
      messageId?: string;
    }) => {
      const title = String(entry.title || '').trim() || '讨论行动项';
      const description = String(entry.content || entry.summary || '').trim();
      const projectId = String(detailQuery.data?.projectId || '').trim();
      const threadId = String(entry.threadId || '').trim();
      const messageId = String(entry.messageId || '').trim();
      const threadTitle = detailQuery.data?.threadTree?.find((thread) => thread.id === threadId)?.title || '讨论线';
      const messagePreview = String(entry.summary || entry.content || '').trim().slice(0, 200);

      return engineeringIntelligenceService.createRequirement({
        title,
        description,
        priority: 'medium',
        category: 'feature',
        complexity: 'low',
        createdById: currentUser?.id,
        createdByName: currentUser?.name,
        createdByType: 'human',
        projectId: projectId || undefined,
        localProjectId: projectId || undefined,
        discussionSource: threadId && messageId
          ? {
              spaceId,
              spaceTitle: detailQuery.data?.title || '讨论空间',
              threadId,
              threadTitle,
              messageId,
              messagePreview,
            }
          : undefined,
      });
    },
    {
      onSuccess: (result) => {
        setActionError('');
        setActionNotice(`需求已创建：${result.requirementId}`);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '转需求失败')
            : '转需求失败';
        setActionError(message);
      },
    },
  );

  const handleOpenArchiveKnowledge = (message: DiscussionMessage) => {
    const normalizedTitle = (message.content || '').replace(/\s+/g, ' ').trim();
    const defaultTitle = normalizedTitle ? `消息#${message.sequence} ${normalizedTitle.slice(0, 40)}` : `消息#${message.sequence} 知识条目`;
    const defaultSummary = normalizedTitle.slice(0, 120);

    setArchiveTargetMessage(message);
    setArchiveMode('existing');
    setArchiveExistingKeyword('');
    setArchiveSelectedKnowledgeEntryIds([]);
    setArchiveCreateTitle(defaultTitle);
    setArchiveCreateSummary(defaultSummary);
    setArchiveCreateContent(message.content || '');
  };

  const handleArchiveSubmit = () => {
    archiveKnowledgeMutation.mutate();
  };

  const toggleArchiveKnowledgeSelection = (knowledgeEntryId: string) => {
    setArchiveSelectedKnowledgeEntryIds((prev) =>
      prev.includes(knowledgeEntryId)
        ? prev.filter((item) => item !== knowledgeEntryId)
        : [...prev, knowledgeEntryId],
    );
  };

  const handleBranch = (message: DiscussionMessage) => {
    const title = window.prompt('请输入新讨论线标题');
    if (!title || !title.trim()) {
      return;
    }
    branchMutation.mutate({ message, title: title.trim() });
  };

  const handleOpenToRequirement = (message: DiscussionMessage) => {
    const fallbackTitle = message.content.trim().replace(/\s+/g, ' ').slice(0, 50) || `讨论消息 #${message.sequence}`;
    setToRequirementMessage(message);
    setToRequirementTitle(fallbackTitle);
    setToRequirementDescription(message.content);
    setToRequirementPriority('medium');
  };

  const handleKnowledgeToRequirement = (entry: {
    id: string;
    title: string;
    content: string;
    summary?: string;
    threadId?: string;
    messageId?: string;
  }) => {
    if (knowledgeToRequirementMutation.isLoading) {
      return;
    }
    knowledgeToRequirementMutation.mutate(entry);
  };

  const handleCloseToRequirement = () => {
    if (toRequirementMutation.isLoading) {
      return;
    }
    setToRequirementMessage(null);
  };

  const handleDeleteThread = (thread: { id: string; title?: string }) => {
    if (!detailQuery.data) {
      return;
    }
    if (thread.id === detailQuery.data.rootThreadId) {
      setActionNotice('');
      setActionError('主讨论线不允许删除');
      return;
    }
    if (deleteThreadMutation.isLoading) {
      return;
    }
    const confirmed = window.confirm(`确认删除讨论线「${thread.title || '未命名讨论线'}」吗？其子讨论线与消息会一并删除，且不可恢复。`);
    if (!confirmed) {
      return;
    }

    setActionError('');
    setActionNotice('');
    deleteThreadMutation.mutate({ id: thread.id });
  };

  const handleCopyAllMessages = async () => {
    if (!sortedMessages.length) {
      setActionError('当前讨论线暂无可复制内容');
      return;
    }

    const content = sortedMessages
      .map((message) => {
        const sender = participantMap[message.participantId]?.displayName || message.senderType;
        return `#${message.sequence} ${sender}\n${message.content}`;
      })
      .join('\n\n-----\n\n');

    try {
      await navigator.clipboard.writeText(content);
      setActionError('');
      setActionNotice('已复制当前讨论线全部消息');
    } catch {
      setActionError('复制失败，请检查浏览器剪贴板权限');
    }
  };

  const sortedMessages = useMemo(() => {
    return [...(messagesQuery.data || [])].sort((a, b) => a.sequence - b.sequence);
  }, [messagesQuery.data]);

  useEffect(() => {
    if (!initialMessageId || focusFromUrlDoneRef.current || !sortedMessages.length) {
      return;
    }

    const matched = sortedMessages.some((item) => item.id === initialMessageId);
    if (!matched) {
      return;
    }

    const node = document.getElementById(`message-${initialMessageId}`);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      focusFromUrlDoneRef.current = true;
    }
  }, [initialMessageId, sortedMessages]);

  useEffect(() => {
    if (!spaceId || !selectedThreadId) {
      return;
    }

    const unsubscribe = discussionService.subscribeThreadMessageEvents(
      spaceId,
      selectedThreadId,
      {
        onEvent: (event: DiscussionMessageStreamEvent) => {
          if (event.type === 'discussion.message.snapshot') {
            void queryClient.invalidateQueries(['discussion-messages', spaceId, selectedThreadId]);
            return;
          }

          if (event.type === 'discussion.message.created') {
            const incoming = event.data.message;
            queryClient.setQueryData<DiscussionMessage[]>(
              ['discussion-messages', spaceId, selectedThreadId],
              (prev = []) => {
                if (prev.some((item) => item.id === incoming.id)) {
                  return prev;
                }
                return [...prev, incoming].sort((a, b) => a.sequence - b.sequence);
              },
            );

            void queryClient.invalidateQueries(['discussion-space-detail', spaceId]);
            if (incoming.senderType === 'ai') {
              void queryClient.invalidateQueries(['discussion-knowledge', spaceId]);
              void queryClient.invalidateQueries(['discussion-sediment-latest', spaceId]);
            }
          }
        },
        onError: () => {
          setActionNotice('实时消息连接已重连中...');
        },
      },
    );

    return () => {
      unsubscribe();
    };
  }, [queryClient, selectedThreadId, spaceId]);

  useEffect(() => {
    return () => {
      sedimentTaskUnsubscribeRef.current?.();
      sedimentTaskUnsubscribeRef.current = null;
    };
  }, []);

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
                void sedimentHistoryQuery.refetch();
                void outlineQuery.refetch();
                void coverageQuery.refetch();
              }}
              className="inline-flex items-center gap-1 border border-[#c6c6c6] px-3 py-2 text-xs text-[#262626] hover:bg-[#f4f4f4]"
            >
              <ArrowPathIcon className="h-4 w-4" />
              刷新
            </button>
          </div>
        </div>

        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_320px] 2xl:grid-cols-[240px_minmax(0,1fr)_360px]">
          <aside className="border-r border-[#c6c6c6] bg-[#f4f4f4] p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-[#161616]">讨论线</div>
              <span className="text-xs text-[#6f6f6f]">{detail.threadTree.length}</span>
            </div>
            <div className="max-h-[calc(100vh-190px)] overflow-auto pr-1">
              <ThreadTree
                threads={detail.threadTree}
                rootThreadId={detail.rootThreadId}
                selectedThreadId={selectedThreadId}
                onSelect={(threadId) => setSelectedThread(spaceId, threadId)}
                onDelete={handleDeleteThread}
              />
            </div>
          </aside>

          <main className="flex min-h-0 flex-col border-r border-[#c6c6c6]">
            <div className="flex items-center justify-between border-b border-[#e0e0e0] px-4 py-2">
              <div className="text-sm text-[#262626]">
                当前讨论线：<span className="font-medium text-[#161616]">{selectedThread?.title || '未选择'}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-[#6f6f6f]">消息 {selectedThread?.messageCount || 0}</div>
                <button
                  type="button"
                  onClick={() => void handleCopyAllMessages()}
                  disabled={!sortedMessages.length}
                  className="border border-[#c6c6c6] px-2 py-1 text-xs text-[#262626] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  复制全部
                </button>
              </div>
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
                  onArchiveKnowledge={handleOpenArchiveKnowledge}
                  onToRequirement={handleOpenToRequirement}
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
            <div className="mb-3 grid grid-cols-4 border border-[#c6c6c6] bg-white">
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
                  latestTitle={latestSedimentQuery.data?.latest?.title || detail.latestSedimentTitle}
                  latestContent={latestSedimentQuery.data?.latest?.content || detail.latestSedimentedDocument}
                  latestCreatedAt={latestSedimentQuery.data?.latest?.createdAt}
                  history={sedimentHistoryQuery.data?.items || []}
                  canDeleteHistory={currentUser?.id === detail.creatorId}
                  deletingHistoryId={
                    typeof deleteSedimentHistoryMutation.variables === 'string' ? deleteSedimentHistoryMutation.variables : undefined
                  }
                  generating={generateSedimentMutation.isLoading || isSedimentStreaming}
                  updatingMode={sedimentModeMutation.isLoading}
                  onChangeMode={(mode) => sedimentModeMutation.mutate(mode)}
                  onGenerate={() => {
                    const inputTitle = window.prompt('请输入本次沉淀标题', selectedThread?.title ? `${selectedThread.title} - 讨论沉淀` : '讨论沉淀') || '';
                    const sedimentTitle = inputTitle.trim();
                    if (!sedimentTitle) {
                      setActionError('沉淀标题不能为空');
                      return;
                    }
                    setActionError('');
                    generateSedimentMutation.mutate(sedimentTitle);
                  }}
                  onDeleteHistory={(historyId) => {
                    if (deleteSedimentHistoryMutation.isLoading) {
                      return;
                    }
                    const confirmed = window.confirm('确认删除该条沉淀历史吗？删除后不可恢复。');
                    if (!confirmed) {
                      return;
                    }
                    setActionError('');
                    setActionNotice('');
                    deleteSedimentHistoryMutation.mutate(historyId);
                  }}
                />
              ) : null}

              {rightPanelTab === 'knowledge' ? (
                <KnowledgePanel
                  keyword={knowledgeKeyword}
                  loading={knowledgeQuery.isLoading}
                  items={knowledgeQuery.data || []}
                  onKeywordChange={(value) => setKnowledgeKeyword(spaceId, value)}
                  creatingRequirementForKnowledgeId={
                    knowledgeToRequirementMutation.isLoading ? knowledgeToRequirementMutation.variables?.id : undefined
                  }
                  onToRequirement={handleKnowledgeToRequirement}
                />
              ) : null}

              {rightPanelTab === 'outline' ? (
                <OutlinePanel
                  outline={outlineQuery.data}
                  coverage={coverageQuery.data}
                  loading={outlineQuery.isLoading || coverageQuery.isLoading}
                  generating={generateOutlineMutation.isLoading}
                  onGenerate={() => generateOutlineMutation.mutate()}
                />
              ) : null}

              {rightPanelTab === 'participants' ? (
                <ParticipantPanel
                  participants={participants}
                  availableAgents={(assignableAgentsQuery.data || []).map((agent) => ({
                    id: agent.id,
                    name: agent.name,
                  }))}
                  selectedAgentId={selectedAgentId}
                  defaultReplyAgentId={detail.settings?.defaultReplyAgentId}
                  addingAgent={addParticipantMutation.isLoading || assignableAgentsQuery.isLoading}
                  removingParticipantId={
                    typeof removeParticipantMutation.variables === 'string' ? removeParticipantMutation.variables : undefined
                  }
                  onSelectAgent={setSelectedAgentId}
                  onDefaultReplyAgentChange={(participantId) => updateDefaultReplyAgentMutation.mutate(participantId)}
                  onAddAgent={() => {
                    if (!selectedAgentId) {
                      setActionError('请先选择一个 Agent');
                      return;
                    }
                    addParticipantMutation.mutate();
                  }}
                  onRemoveParticipant={(participantId) => removeParticipantMutation.mutate(participantId)}
                />
              ) : null}
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

        {!actionError && actionNotice ? (
          <div className="border-t border-[#24a148] bg-[#f3fff6] px-4 py-2 text-xs text-[#198038]">
            {actionNotice}
          </div>
        ) : null}

      <KnowledgeArchiveModal
          open={Boolean(archiveTargetMessage)}
          mode={archiveMode}
          messageSequence={archiveTargetMessage?.sequence}
          messagePreview={archiveTargetMessage?.content || ''}
          existingKeyword={archiveExistingKeyword}
          existingItems={archiveKnowledgeOptionsQuery.data || []}
          selectedKnowledgeEntryIds={archiveSelectedKnowledgeEntryIds}
          createTitle={archiveCreateTitle}
          createSummary={archiveCreateSummary}
          createContent={archiveCreateContent}
          submitting={archiveKnowledgeMutation.isLoading}
          loadingExisting={archiveKnowledgeOptionsQuery.isLoading}
          onClose={() => {
            if (archiveKnowledgeMutation.isLoading) {
              return;
            }
            setArchiveTargetMessage(null);
          }}
          onModeChange={setArchiveMode}
          onExistingKeywordChange={setArchiveExistingKeyword}
          onToggleExisting={toggleArchiveKnowledgeSelection}
          onCreateTitleChange={setArchiveCreateTitle}
          onCreateSummaryChange={setArchiveCreateSummary}
          onCreateContentChange={setArchiveCreateContent}
        onSubmit={handleArchiveSubmit}
      />

      <MessageToRequirementModal
        open={Boolean(toRequirementMessage)}
        messageSequence={toRequirementMessage?.sequence}
        messagePreview={toRequirementMessage?.content || ''}
        title={toRequirementTitle}
        description={toRequirementDescription}
        priority={toRequirementPriority}
        projectId={detail.projectId}
        submitting={toRequirementMutation.isLoading}
        onClose={handleCloseToRequirement}
        onTitleChange={setToRequirementTitle}
        onDescriptionChange={setToRequirementDescription}
        onPriorityChange={setToRequirementPriority}
        onSubmit={() => toRequirementMutation.mutate()}
      />
      </div>
    </div>
  );
};

export default DiscussionDetail;
