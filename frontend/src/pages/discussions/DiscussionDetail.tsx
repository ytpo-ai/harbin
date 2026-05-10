import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowPathIcon, ChevronLeftIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import MessageBubble from '../../components/discussion/MessageBubble';
import MessageInput from '../../components/discussion/MessageInput';
import ThreadTree from '../../components/discussion/ThreadTree';
import SedimentPanel from '../../components/discussion/SedimentPanel';
import OutlinePanel from '../../components/discussion/OutlinePanel';
import OutlineSectionModal from '../../components/discussion/OutlineSectionModal';
import KnowledgePanel from '../../components/discussion/KnowledgePanel';
import ParticipantPanel from '../../components/discussion/ParticipantPanel';
import KnowledgeArchiveModal from '../../components/discussion/KnowledgeArchiveModal';
import MessageToRequirementModal from '../../components/discussion/MessageToRequirementModal';
import { engineeringIntelligenceService } from '../../services/engineeringIntelligenceService';
import { agentService } from '../../services/agentService';
import { authService, CurrentUser } from '../../services/authService';
import {
  DiscussionAgentExecutionStatus,
  discussionService,
  DiscussionKnowledgeEntry,
  DiscussionMessage,
  DiscussionMessageStreamEvent,
  OutlineSection,
  DiscussionParticipant,
  DiscussionOutlineTaskStreamEvent,
  DiscussionSedimentTaskStreamEvent,
} from '../../services/discussionService';
import { DiscussionRightPanelTab, useDiscussionStore } from '../../stores/discussionStore';

const rightTabLabel: Record<DiscussionRightPanelTab, string> = {
  sediment: '文档沉淀',
  outline: '大纲',
  knowledge: '知识库',
  participants: '参与者',
};

const spaceStatusLabelMap: Record<'active' | 'paused' | 'archived', string> = {
  active: '进行中',
  paused: '已暂停',
  archived: '已归档',
};

const outlineSectionStatusLabelMap: Record<OutlineSection['status'], string> = {
  draft: '草稿',
  enriching: '补充中（知识未达充足）',
  sufficient: '已充分',
  review: '待复核',
};

const SECTION_ENRICH_PROMPT = [
  '请围绕当前章节主题补充 3 条可入库的知识条目，并优先调用可用的搜索工具检索信息。',
  '请至少参考 2 个独立来源，并在回答里附上可追溯来源。',
  '输出时请用 ```json code block``` 包裹对象，格式为 {"searchEvidence":[...],"entries":[...]}。',
  'searchEvidence 每条包含 sourceName/sourceUrl/snippet/query/fetchedAt 字段；entries 每条包含 title/content/summary/entryType/sourceUrl/sourceName/credibility 字段。',
  '如果关键信息不足，你可以先反问我 1-2 个澄清问题；如果已足够，请直接给出可执行结论。',
].join('\n');

type MessageDataReference = {
  dataRecordId: string;
  dataSourceName: string;
  dataPreview: string;
  collectedAt: string;
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
  const [isOutlineStreaming, setIsOutlineStreaming] = useState(false);
  const [archiveTargetMessage, setArchiveTargetMessage] = useState<DiscussionMessage | null>(null);
  const [archiveMode, setArchiveMode] = useState<'existing' | 'create'>('existing');
  const [archiveExistingKeyword, setArchiveExistingKeyword] = useState('');
  const [archiveSelectedKnowledgeEntryIds, setArchiveSelectedKnowledgeEntryIds] = useState<string[]>([]);
  const [archiveCreateTitle, setArchiveCreateTitle] = useState('');
  const [archiveCreateSummary, setArchiveCreateSummary] = useState('');
  const [archiveCreateContent, setArchiveCreateContent] = useState('');
  const [knowledgeOutlineSectionId, setKnowledgeOutlineSectionId] = useState('');
  const [selectedOutlineTemplateId, setSelectedOutlineTemplateId] = useState('');
  const [outlineSectionModalOpen, setOutlineSectionModalOpen] = useState(false);
  const [outlineSectionModalMode, setOutlineSectionModalMode] = useState<'create' | 'edit'>('create');
  const [editingOutlineSection, setEditingOutlineSection] = useState<OutlineSection | null>(null);
  const [outlineSectionTitle, setOutlineSectionTitle] = useState('');
  const [outlineSectionDescription, setOutlineSectionDescription] = useState('');
  const [outlineSectionStatus, setOutlineSectionStatus] = useState<OutlineSection['status']>('draft');
  const [outlineSectionParentId, setOutlineSectionParentId] = useState('');
  const [toRequirementMessage, setToRequirementMessage] = useState<DiscussionMessage | null>(null);
  const [toRequirementTitle, setToRequirementTitle] = useState('');
  const [toRequirementDescription, setToRequirementDescription] = useState('');
  const [toRequirementPriority, setToRequirementPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [runningAgentParticipantIds, setRunningAgentParticipantIds] = useState<string[]>([]);
  const sedimentTaskUnsubscribeRef = useRef<null | (() => void)>(null);
  const outlineTaskUnsubscribeRef = useRef<null | (() => void)>(null);
  const focusFromUrlDoneRef = useRef(false);
  const runningAgentTimeoutsRef = useRef<Map<string, number>>(new Map());

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

  useEffect(() => {
    setKnowledgeOutlineSectionId('');
  }, [spaceId]);

  const messagesQuery = useQuery(
    ['discussion-messages', spaceId, selectedThreadId],
    () => discussionService.listMessages(spaceId, selectedThreadId, 200),
    {
      enabled: Boolean(spaceId && selectedThreadId),
      staleTime: 3_000,
    },
  );

  const knowledgeQuery = useQuery(
    ['discussion-knowledge', spaceId, selectedThreadId, knowledgeKeyword, knowledgeOutlineSectionId],
    () =>
      discussionService.listKnowledge(spaceId, {
        threadId: selectedThreadId || undefined,
        keyword: knowledgeKeyword.trim() || undefined,
        outlineSectionId: knowledgeOutlineSectionId || undefined,
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
  const outlineTemplatesQuery = useQuery(
    ['ei-outline-template-options', detailQuery.data?.metadata?.industryContext || ''],
    () =>
      engineeringIntelligenceService.listOutlineTemplates({
        type: 'industry_observation',
        industry: detailQuery.data?.metadata?.industryContext,
      }),
    {
      enabled: Boolean(spaceId),
      staleTime: 60_000,
    },
  );

  const recalculateOutlineDepth = (sections: OutlineSection[]): OutlineSection[] => {
    const sectionMap = new Map(sections.map((item) => [item.id, item]));

    const resolveDepth = (section: OutlineSection, visited: Set<string>): number => {
      const parentId = String(section.parentSectionId || '').trim();
      if (!parentId) {
        return 0;
      }
      if (visited.has(section.id)) {
        return section.depth || 0;
      }
      const parent = sectionMap.get(parentId);
      if (!parent) {
        return 0;
      }
      const nextVisited = new Set(visited);
      nextVisited.add(section.id);
      return resolveDepth(parent, nextVisited) + 1;
    };

    return sections.map((section) => ({
      ...section,
      depth: resolveDepth(section, new Set()),
    }));
  };

  const sortedOutlineSections = useMemo(() => {
    return (outlineQuery.data?.sections || []).slice().sort((a, b) => {
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      return a.order - b.order;
    });
  }, [outlineQuery.data?.sections]);

  const selectedOutlineSection = useMemo(() => {
    const outlineSectionId = String(selectedThread?.outlineSectionId || '').trim();
    if (!outlineSectionId) {
      return undefined;
    }
    return sortedOutlineSections.find((section) => section.id === outlineSectionId);
  }, [selectedThread?.outlineSectionId, sortedOutlineSections]);

  const outlineSectionParentOptions = useMemo(() => {
    const editingId = String(editingOutlineSection?.id || '').trim();
    if (!editingId) {
      return sortedOutlineSections;
    }

    const childrenMap = new Map<string, string[]>();
    for (const section of sortedOutlineSections) {
      const parentId = String(section.parentSectionId || '').trim();
      if (!parentId) {
        continue;
      }
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)?.push(section.id);
    }

    const blocked = new Set<string>([editingId]);
    const queue = [editingId];
    while (queue.length) {
      const current = queue.shift() as string;
      const children = childrenMap.get(current) || [];
      for (const childId of children) {
        if (blocked.has(childId)) {
          continue;
        }
        blocked.add(childId);
        queue.push(childId);
      }
    }

    return sortedOutlineSections.filter((item) => !blocked.has(item.id));
  }, [sortedOutlineSections, editingOutlineSection?.id]);

  const savePrefillSourcesToDashboard = (templateId: string) => {
    const projectId = String(detailQuery.data?.projectId || '').trim();
    if (!projectId) {
      return;
    }

    const selectedTemplate = (outlineTemplatesQuery.data || []).find((item) => item._id === templateId);
    if (!selectedTemplate || !Array.isArray(selectedTemplate.suggestedDataSources) || selectedTemplate.suggestedDataSources.length === 0) {
      return;
    }

    const storageKey = `ei-data-source-prefill:${projectId}`;
    const existedRaw = window.sessionStorage.getItem(storageKey);
    let existed: Array<Record<string, unknown>> = [];
    if (existedRaw) {
      try {
        existed = JSON.parse(existedRaw) as Array<Record<string, unknown>>;
      } catch {
        existed = [];
      }
    }
    const next = [
      ...existed,
      ...selectedTemplate.suggestedDataSources.map((item, index) => ({
        id: `${templateId}-${index}-${Date.now()}`,
        name: item.name,
        sourceType: item.sourceType,
        config: item.config,
        collectFrequency: item.collectFrequency,
        templateId,
        templateName: selectedTemplate.name,
        discussionSpaceId: spaceId,
      })),
    ];
    window.sessionStorage.setItem(storageKey, JSON.stringify(next));
  };
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

  const clearRunningAgentTimeout = useCallback((participantId: string) => {
    const timer = runningAgentTimeoutsRef.current.get(participantId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      runningAgentTimeoutsRef.current.delete(participantId);
    }
  }, []);

  const removeRunningAgentParticipants = useCallback(
    (participantIds: string[]) => {
      const normalizedIds = participantIds.filter(Boolean);
      if (!normalizedIds.length) {
        return;
      }
      for (const participantId of normalizedIds) {
        clearRunningAgentTimeout(participantId);
      }
      setRunningAgentParticipantIds((prev) => prev.filter((item) => !normalizedIds.includes(item)));
    },
    [clearRunningAgentTimeout],
  );

  const addRunningAgentParticipants = useCallback(
    (participantIds: string[]) => {
      const normalizedIds = participantIds.filter(Boolean);
      if (!normalizedIds.length) {
        return;
      }

      setRunningAgentParticipantIds((prev) => {
        const merged = new Set(prev);
        for (const participantId of normalizedIds) {
          merged.add(participantId);
        }
        return Array.from(merged);
      });

      for (const participantId of normalizedIds) {
        clearRunningAgentTimeout(participantId);
        const timer = window.setTimeout(() => {
          runningAgentTimeoutsRef.current.delete(participantId);
          setRunningAgentParticipantIds((prev) => prev.filter((item) => item !== participantId));
        }, 60_000);
        runningAgentTimeoutsRef.current.set(participantId, timer);
      }
    },
    [clearRunningAgentTimeout],
  );

  const resolveLikelyTriggeredAgentParticipantIds = useCallback(
    (content: string): string[] => {
      const normalizedContent = String(content || '').trim();
      if (!normalizedContent) {
        return [];
      }

      const aiParticipants = participants.filter((item) => item.type === 'ai_agent');
      if (!aiParticipants.length) {
        return [];
      }

      const mentionMatches = Array.from(normalizedContent.matchAll(/@([^\s@]+)/g))
        .map((match) => String(match[1] || '').trim().toLowerCase())
        .filter(Boolean);

      if (mentionMatches.length) {
        return aiParticipants
          .filter((participant) => {
            const displayName = String(participant.displayName || '').trim();
            const aliases = [displayName, displayName.replace(/\s+/g, ''), String(participant.id || '')]
              .map((item) => item.toLowerCase())
              .filter(Boolean);
            return mentionMatches.some((mention) => aliases.includes(mention));
          })
          .map((participant) => participant.id);
      }

      const defaultReplyAgentId = String(detailQuery.data?.settings?.defaultReplyAgentId || '').trim();
      if (!defaultReplyAgentId) {
        return [];
      }

      return aiParticipants.some((item) => item.id === defaultReplyAgentId) ? [defaultReplyAgentId] : [];
    },
    [detailQuery.data?.settings?.defaultReplyAgentId, participants],
  );

  const sendDiscussionMessage = async (input: { content: string; threadId?: string; dataReferences?: MessageDataReference[] }) => {
    const content = String(input.content || '').trim();
    const targetThreadId = String(input.threadId || selectedThreadId || '').trim();
    if (!targetThreadId) {
      throw new Error('请先选择讨论线');
    }
    if (!currentParticipant) {
      throw new Error('当前空间暂无可用参与者，无法发送消息');
    }
    if (!content) {
      throw new Error('消息内容不能为空');
    }

    addRunningAgentParticipants(resolveLikelyTriggeredAgentParticipantIds(content));

    await discussionService.sendMessage(spaceId, targetThreadId, {
      participantId: currentParticipant.id,
      senderType: 'user',
      content,
      dataReferences: input.dataReferences || [],
    });
  };

  const buildOutlineInjectionMessage = (): string => {
    const outline = outlineQuery.data;
    if (!outline || !Array.isArray(outline.sections) || outline.sections.length === 0) {
      throw new Error('当前暂无可注入的大纲');
    }

    const updatedAt = outline.updatedAt ? new Date(outline.updatedAt) : null;
    const updatedAtText = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toLocaleString() : '-';
    const coverageMap = new Map((coverageQuery.data?.sectionDetails || []).map((item) => [item.sectionId, item]));
    const sectionLines = sortedOutlineSections.map((section) => {
      const indent = '  '.repeat(Math.max(0, section.depth));
      const statusLabel = outlineSectionStatusLabelMap[section.status] || section.status;
      const knowledgeCount = Number(section.knowledgeCount || 0);
      const coverage = coverageMap.get(section.id);
      const latestEntryDate = coverage?.latestEntryDate ? new Date(coverage.latestEntryDate) : null;
      const latestEntryText = latestEntryDate && !Number.isNaN(latestEntryDate.getTime()) ? latestEntryDate.toLocaleString() : '无';
      const description = String(section.description || '').trim() || '无';
      const parentSectionId = String(section.parentSectionId || '').trim() || '无';
      const suggestedDataSources = (section.metadata?.suggestedDataSources || []).filter(Boolean);
      const suggestedDataSourcesText = suggestedDataSources.length ? suggestedDataSources.join('、') : '无';
      const collectFrequency = String(section.metadata?.collectFrequency || '').trim() || '未指定';
      const structuredDataLabel = section.metadata?.isStructuredData ? '是' : '否';

      return [
        `${indent}- [${section.id}] ${section.title}`,
        `${indent}  - 状态：${statusLabel}`,
        `${indent}  - 深度/顺序：${section.depth}/${section.order}`,
        `${indent}  - 父章节：${parentSectionId}`,
        `${indent}  - 描述：${description}`,
        `${indent}  - 知识条目数：${knowledgeCount}`,
        `${indent}  - 最新知识时间：${latestEntryText}`,
        `${indent}  - 建议数据源：${suggestedDataSourcesText}`,
        `${indent}  - 采集频率：${collectFrequency}`,
        `${indent}  - 是否结构化数据章节：${structuredDataLabel}`,
      ].join('\n');
    });

    const outlinePayload = {
      title: outline.title,
      version: outline.version,
      generatedBy: outline.generatedBy,
      updatedAt: outline.updatedAt,
      sections: sortedOutlineSections.map((section) => ({
        id: section.id,
        title: section.title,
        description: section.description || '',
        parentSectionId: section.parentSectionId || '',
        order: section.order,
        depth: section.depth,
        status: section.status,
        knowledgeCount: section.knowledgeCount,
        metadata: section.metadata || {},
      })),
    };

    return [
      '【文档大纲注入】',
      `标题：${outline.title || '未命名大纲'}`,
      `版本：v${Number(outline.version || 1)}`,
      `更新时间：${updatedAtText}`,
      `章节总数：${outline.sections.length}`,
      '章节详细列表：',
      ...sectionLines,
      '',
      '完整大纲 JSON：',
      '```json',
      JSON.stringify(outlinePayload, null, 2),
      '```',
      '',
      '请基于以上大纲继续讨论。',
    ].join('\n');
  };

  const sendMessageMutation = useMutation(
    async (dataReferences: MessageDataReference[]) => {
      await sendDiscussionMessage({
        content: messageText,
        dataReferences,
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
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '消息发送失败，请稍后重试')
            : '消息发送失败，请稍后重试';
        setActionError(message);
      },
    },
  );

  const injectOutlineMessageMutation = useMutation(
    async () => {
      const content = buildOutlineInjectionMessage();
      await sendDiscussionMessage({ content });
    },
    {
      onSuccess: async () => {
        setActionError('');
        setActionNotice('已将当前大纲注入讨论消息');
        await Promise.all([
          queryClient.invalidateQueries(['discussion-messages', spaceId, selectedThreadId]),
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
          queryClient.invalidateQueries(['discussion-sediment-latest', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '大纲注入失败，请稍后重试')
            : '大纲注入失败，请稍后重试';
        setActionError(message);
      },
    },
  );

  const archiveSpaceMutation = useMutation(
    async () => discussionService.archiveSpace(spaceId, currentUser?.id),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries(['discussion-space-detail', spaceId]);
        await queryClient.invalidateQueries('discussion-spaces');
        setActionError('');
        setActionNotice('讨论空间已归档，当前为只读状态');
      },
      onError: () => {
        setActionNotice('');
        setActionError('归档失败，请稍后重试');
      },
    },
  );

  const unarchiveSpaceMutation = useMutation(
    async () => discussionService.unarchiveSpace(spaceId),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries(['discussion-space-detail', spaceId]);
        await queryClient.invalidateQueries('discussion-spaces');
        setActionError('');
        setActionNotice('讨论空间已取消归档，恢复可写');
      },
      onError: () => {
        setActionNotice('');
        setActionError('取消归档失败，请稍后重试');
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

  const startOutlineTaskStream = (taskId: string) => {
    outlineTaskUnsubscribeRef.current?.();
    setIsOutlineStreaming(true);

    const stop = discussionService.subscribeOutlineTaskEvents(spaceId, taskId, {
      onEvent: (event: DiscussionOutlineTaskStreamEvent) => {
        const task = event.data.task;
        const status = task?.status;
        if (!status) {
          return;
        }

        if (status === 'queued' || status === 'running') {
          setActionError('');
          if (task.taskType === 'generate') {
            setActionNotice('大纲任务执行中，请稍候...');
          } else {
            setActionNotice('大纲任务执行中，请稍候...');
          }
          return;
        }

        if (status === 'succeeded') {
          setIsOutlineStreaming(false);
          outlineTaskUnsubscribeRef.current?.();
          outlineTaskUnsubscribeRef.current = null;
          setActionError('');

          if (task.taskType === 'generate') {
            setActionNotice('大纲生成完成，已刷新大纲与覆盖率');
          } else {
            setActionNotice('大纲任务已完成');
          }

          void Promise.all([
            queryClient.invalidateQueries(['discussion-outline', spaceId]),
            queryClient.invalidateQueries(['discussion-knowledge-coverage', spaceId]),
            queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
            queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
          ]);
          return;
        }

        if (status === 'failed') {
          setIsOutlineStreaming(false);
          outlineTaskUnsubscribeRef.current?.();
          outlineTaskUnsubscribeRef.current = null;
          setActionNotice('');
          setActionError(task.error || '大纲任务失败，请稍后重试');
        }
      },
      onError: () => {
        setIsOutlineStreaming(false);
        outlineTaskUnsubscribeRef.current?.();
        outlineTaskUnsubscribeRef.current = null;
        void Promise.all([
          queryClient.invalidateQueries(['discussion-outline', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge-coverage', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
        ]);
        setActionError('大纲任务连接中断，已自动刷新最新状态');
      },
    });

    outlineTaskUnsubscribeRef.current = stop;
  };

  const generateOutlineMutation = useMutation(
    async () => {
      return discussionService.generateOutlineTask(spaceId, {
        industryContext: detailQuery.data?.metadata?.industryContext,
      });
    },
    {
      onSuccess: (task) => {
        setActionError('');
        setActionNotice('大纲任务已提交，正在连接结果流...');
        if (task?.taskId) {
          startOutlineTaskStream(task.taskId);
          return;
        }
        setActionError('大纲任务创建失败，请稍后重试');
      },
      onError: () => {
        setActionError('生成大纲失败，请稍后重试');
      },
    },
  );

  const openSectionThreadMutation = useMutation(
    async (payload: { section: OutlineSection; triggerEnrich: boolean }) => {
      const thread = await discussionService.getOrCreateSectionThread(spaceId, payload.section.id, payload.section.title);
      if (payload.triggerEnrich) {
        if (!currentParticipant?.id) {
          throw new Error('当前空间暂无可用参与者，无法发起章节补充');
        }
        await discussionService.sendMessage(spaceId, thread.id, {
          participantId: currentParticipant.id,
          senderType: 'user',
          content: SECTION_ENRICH_PROMPT,
        });
      }
      return {
        thread,
        section: payload.section,
        triggerEnrich: payload.triggerEnrich,
      };
    },
    {
      onSuccess: async ({ thread, section, triggerEnrich }) => {
        setSelectedThread(spaceId, thread.id);
        setRightPanelTab(spaceId, 'knowledge');
        setKnowledgeOutlineSectionId(section.id);
        setActionError('');
        setActionNotice(
          triggerEnrich
            ? `已进入章节「${section.title}」讨论线，并自动发起补充请求`
            : `已进入章节「${section.title}」讨论线`,
        );
        await Promise.all([
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
          queryClient.invalidateQueries(['discussion-messages', spaceId, thread.id]),
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '章节讨论切换失败')
            : '章节讨论切换失败';
        setActionError(message);
      },
    },
  );

  const enrichCurrentSectionMutation = useMutation(
    async () => {
      const thread = selectedThread;
      const outlineSectionId = String(thread?.outlineSectionId || '').trim();
      if (!thread?.id || !outlineSectionId) {
        throw new Error('当前讨论线未关联章节，无法执行丰富');
      }
      await sendDiscussionMessage({
        content: SECTION_ENRICH_PROMPT,
        threadId: thread.id,
      });
      return {
        threadId: thread.id,
        sectionTitle: selectedOutlineSection?.title || thread.title,
      };
    },
    {
      onSuccess: async (result) => {
        setActionError('');
        setActionNotice(`已在章节「${result.sectionTitle || '当前章节'}」讨论线发起丰富请求`);
        await Promise.all([
          queryClient.invalidateQueries(['discussion-messages', spaceId, result.threadId]),
          queryClient.invalidateQueries(['discussion-space-detail', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
          queryClient.invalidateQueries(['discussion-sediment-latest', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '章节丰富请求发送失败')
            : '章节丰富请求发送失败';
        setActionError(message);
      },
    },
  );

  const deleteKnowledgeEntryMutation = useMutation(
    async (entry: DiscussionKnowledgeEntry) => {
      return discussionService.deleteKnowledge(spaceId, entry.id);
    },
    {
      onSuccess: async (_, entry) => {
        setActionError('');
        setActionNotice(`已删除条目「${entry.title}」`);
        await Promise.all([
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
          queryClient.invalidateQueries(['discussion-outline', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge-coverage', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '删除知识条目失败')
            : '删除知识条目失败';
        setActionError(message);
      },
    },
  );

  const enrichAllOutlineSectionsMutation = useMutation(
    async () => {
      return discussionService.enrichAllOutlineSections(spaceId);
    },
    {
      onSuccess: async (result) => {
        setActionError('');
        setActionNotice(
          result.processedSectionIds.length > 0
            ? `已处理 ${result.processedSectionIds.length} 个 draft 章节，补充 ${result.enrichedCount} 条知识`
            : '当前没有 draft 章节需要批量丰富',
        );
        await Promise.all([
          queryClient.invalidateQueries(['discussion-outline', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge-coverage', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '批量丰富失败')
            : '批量丰富失败';
        setActionError(message);
      },
    },
  );

  const addOutlineSectionMutation = useMutation(
    async (payload: { title: string; description?: string; status?: OutlineSection['status']; parentSectionId?: string }) => {
      return discussionService.addOutlineSection(spaceId, payload);
    },
    {
      onSuccess: async () => {
        setActionError('');
        setActionNotice('章节已新增');
        await Promise.all([
          queryClient.invalidateQueries(['discussion-outline', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge-coverage', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '新增章节失败')
            : '新增章节失败';
        setActionError(message);
      },
    },
  );

  const editOutlineSectionMutation = useMutation(
    async (payload: { sectionId: string; title: string; description?: string; status: OutlineSection['status']; parentSectionId?: string }) => {
      const outline = outlineQuery.data;
      if (!outline) {
        throw new Error('当前无可用大纲，无法更新章节');
      }

      const target = outline.sections.find((item) => item.id === payload.sectionId);
      if (!target) {
        throw new Error('未找到待更新章节');
      }

      const nextParentId = String(payload.parentSectionId || '').trim();
      const currentParentId = String(target.parentSectionId || '').trim();
      const parentChanged = nextParentId !== currentParentId;

      let nextOrder = target.order;
      if (parentChanged) {
        const siblingOrders = outline.sections
          .filter((item) => item.id !== payload.sectionId && String(item.parentSectionId || '') === nextParentId)
          .map((item) => item.order);
        nextOrder = siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0;
      }

      const nextSections = recalculateOutlineDepth(
        outline.sections.map((section) => {
          if (section.id !== payload.sectionId) {
            return section;
          }
          return {
            ...section,
            title: payload.title,
            description: payload.description,
            status: payload.status,
            parentSectionId: nextParentId || undefined,
            order: nextOrder,
          };
        }),
      );

      return discussionService.updateOutline(spaceId, {
        title: outline.title,
        sections: nextSections,
        generatedBy: 'human',
      });
    },
    {
      onSuccess: async () => {
        setActionError('');
        setActionNotice('章节已更新');
        await Promise.all([
          queryClient.invalidateQueries(['discussion-outline', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge-coverage', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '更新章节失败')
            : '更新章节失败';
        setActionError(message);
      },
    },
  );

  const clearOutlineSectionEnrichmentMutation = useMutation(
    async (section: OutlineSection) => {
      return discussionService.clearOutlineSectionEnrichments(spaceId, section.id);
    },
    {
      onSuccess: async (result, section) => {
        setActionError('');
        setActionNotice(`章节「${section.title}」补充内容已清空（${result.clearedKnowledgeCount} 条）`);
        await Promise.all([
          queryClient.invalidateQueries(['discussion-outline', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge-coverage', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '删除章节失败')
            : '删除章节失败';
        setActionError(message);
      },
    },
  );

  const moveOutlineSectionMutation = useMutation(
    async (payload: { sectionId: string; direction: 'up' | 'down' }) => {
      const outline = outlineQuery.data;
      if (!outline) {
        throw new Error('当前无可用大纲，无法调整顺序');
      }

      const target = outline.sections.find((item) => item.id === payload.sectionId);
      if (!target) {
        throw new Error('未找到目标章节');
      }

      const siblings = outline.sections
        .filter((item) => String(item.parentSectionId || '') === String(target.parentSectionId || ''))
        .slice()
        .sort((a, b) => a.order - b.order);
      const currentIndex = siblings.findIndex((item) => item.id === payload.sectionId);
      if (currentIndex < 0) {
        throw new Error('章节排序信息异常');
      }

      const swapIndex = payload.direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (swapIndex < 0 || swapIndex >= siblings.length) {
        return outline;
      }

      const nextSiblings = siblings.slice();
      const temp = nextSiblings[currentIndex];
      nextSiblings[currentIndex] = nextSiblings[swapIndex];
      nextSiblings[swapIndex] = temp;

      const siblingOrderMap = new Map<string, number>();
      nextSiblings.forEach((item, index) => {
        siblingOrderMap.set(item.id, index);
      });

      const nextSections = outline.sections.map((section) => {
        if (siblingOrderMap.has(section.id)) {
          return {
            ...section,
            order: siblingOrderMap.get(section.id) || 0,
          };
        }
        return section;
      });

      return discussionService.updateOutline(spaceId, {
        title: outline.title,
        sections: nextSections,
        generatedBy: 'human',
      });
    },
    {
      onSuccess: async () => {
        setActionError('');
        setActionNotice('章节顺序已更新');
        await queryClient.invalidateQueries(['discussion-outline', spaceId]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '调整章节顺序失败')
            : '调整章节顺序失败';
        setActionError(message);
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

  const updateAutoAnalysisOnDataUpdateMutation = useMutation(
    async (enabled: boolean) => {
      const settings = {
        ...(detailQuery.data?.settings || {}),
        autoAnalysisOnDataUpdate: enabled,
      };

      return discussionService.updateSpace(spaceId, { settings });
    },
    {
      onSuccess: async (_, enabled) => {
        await queryClient.invalidateQueries(['discussion-space-detail', spaceId]);
        setActionError('');
        setActionNotice(enabled ? '已开启数据更新自动分析' : '已关闭数据更新自动分析');
      },
      onError: () => {
        setActionError('更新自动分析开关失败');
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

  const applyOutlineTemplateMutation = useMutation(
    async () => {
      const templateId = String(selectedOutlineTemplateId || '').trim();
      if (!templateId) {
        throw new Error('请先选择一个模板');
      }

      return engineeringIntelligenceService.applyOutlineTemplate(templateId, {
        spaceId,
        outlineTitle: detailQuery.data?.title ? `${detailQuery.data.title} 大纲` : undefined,
      });
    },
    {
      onSuccess: async () => {
        const templateId = String(selectedOutlineTemplateId || '').trim();
        if (templateId) {
          savePrefillSourcesToDashboard(templateId);
        }
        setActionError('');
        setActionNotice('大纲模板已应用，建议数据源已预填到数据看板');
        await Promise.all([
          queryClient.invalidateQueries(['discussion-outline', spaceId]),
          queryClient.invalidateQueries(['discussion-knowledge-coverage', spaceId]),
        ]);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '模板应用失败')
            : '模板应用失败';
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

  const openCreateOutlineSectionModal = (parentSectionId?: string) => {
    setOutlineSectionModalMode('create');
    setEditingOutlineSection(null);
    setOutlineSectionTitle('新章节');
    setOutlineSectionDescription('');
    setOutlineSectionStatus('draft');
    setOutlineSectionParentId(String(parentSectionId || ''));
    setOutlineSectionModalOpen(true);
  };

  const openEditOutlineSectionModal = (section: OutlineSection) => {
    setOutlineSectionModalMode('edit');
    setEditingOutlineSection(section);
    setOutlineSectionTitle(section.title || '');
    setOutlineSectionDescription(section.description || '');
    setOutlineSectionStatus(section.status || 'draft');
    setOutlineSectionParentId(String(section.parentSectionId || ''));
    setOutlineSectionModalOpen(true);
  };

  const closeOutlineSectionModal = () => {
    setOutlineSectionModalOpen(false);
    setEditingOutlineSection(null);
    setOutlineSectionParentId('');
  };

  const handleSubmitOutlineSectionModal = () => {
    const title = outlineSectionTitle.trim();
    if (!title) {
      setActionError('章节标题不能为空');
      return;
    }

    setActionError('');
    setActionNotice('');

    if (outlineSectionModalMode === 'create') {
      addOutlineSectionMutation.mutate(
        {
          title,
          description: outlineSectionDescription.trim() || undefined,
          status: outlineSectionStatus,
          parentSectionId: outlineSectionParentId || undefined,
        },
        {
          onSuccess: () => {
            closeOutlineSectionModal();
          },
        },
      );
      return;
    }

    if (!editingOutlineSection?.id) {
      setActionError('未找到待编辑章节');
      return;
    }

    editOutlineSectionMutation.mutate(
      {
        sectionId: editingOutlineSection.id,
        title,
        description: outlineSectionDescription.trim() || undefined,
        status: outlineSectionStatus,
        parentSectionId: outlineSectionParentId || undefined,
      },
      {
        onSuccess: () => {
          closeOutlineSectionModal();
        },
      },
    );
  };

  const handleClearOutlineSectionEnrichment = (section: OutlineSection) => {
    const confirmed = window.confirm(
      `确认清空章节「${section.title}」的补充内容吗？\n将删除本章节下所有自动生成的知识条目（含补充与聊天产出），用户手动创建的条目会保留。`,
    );
    if (!confirmed) {
      return;
    }

    setActionError('');
    setActionNotice('');
    clearOutlineSectionEnrichmentMutation.mutate(section);
  };

  const handleMoveOutlineSection = (section: OutlineSection, direction: 'up' | 'down') => {
    setActionError('');
    setActionNotice('');
    moveOutlineSectionMutation.mutate({ sectionId: section.id, direction });
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

  const handleDeleteGeneratedKnowledge = (entry: DiscussionKnowledgeEntry) => {
    if (deleteKnowledgeEntryMutation.isLoading) {
      return;
    }
    const confirmed = window.confirm(`确认删除条目「${entry.title}」吗？删除后不可恢复。`);
    if (!confirmed) {
      return;
    }
    setActionError('');
    setActionNotice('');
    deleteKnowledgeEntryMutation.mutate(entry);
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

  const runningAgents = useMemo(() => {
    return runningAgentParticipantIds
      .map((participantId) => participantMap[participantId] as DiscussionParticipant | undefined)
      .filter((participant): participant is DiscussionParticipant => Boolean(participant));
  }, [participantMap, runningAgentParticipantIds]);

  const knowledgeEntryMap = useMemo(() => {
    return new Map((knowledgeQuery.data || []).map((item) => [item.id, item]));
  }, [knowledgeQuery.data]);

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

    for (const timer of runningAgentTimeoutsRef.current.values()) {
      window.clearTimeout(timer);
    }
    runningAgentTimeoutsRef.current.clear();
    setRunningAgentParticipantIds([]);

    const unsubscribe = discussionService.subscribeThreadMessageEvents(
      spaceId,
      selectedThreadId,
      {
        onEvent: (event: DiscussionMessageStreamEvent) => {
          if (event.type === 'discussion.message.snapshot') {
            void queryClient.invalidateQueries(['discussion-messages', spaceId, selectedThreadId]);
            return;
          }

          if (event.type === 'discussion.agent.execution.status') {
            const status = event.data.status as DiscussionAgentExecutionStatus;
            const participantId = event.data.participantId;
            if (status === 'running') {
              addRunningAgentParticipants([participantId]);
              return;
            }

            removeRunningAgentParticipants([participantId]);
            void queryClient.invalidateQueries(['discussion-messages', spaceId, selectedThreadId]);
            if (status === 'completed') {
              void queryClient.invalidateQueries(['discussion-knowledge', spaceId]);
              void queryClient.invalidateQueries(['discussion-sediment-latest', spaceId]);
            }
            return;
          }

          if (event.type === 'discussion.message.created') {
            const streamMessage = event.data.message as DiscussionMessage & { _id?: string };
            const normalizedIncomingId = String(streamMessage.id || streamMessage._id || '').trim();
            const incoming: DiscussionMessage = normalizedIncomingId
              ? {
                  ...streamMessage,
                  id: normalizedIncomingId,
                }
              : streamMessage;
            if (incoming.senderType === 'ai') {
              removeRunningAgentParticipants([incoming.participantId]);
            }
            queryClient.setQueryData<DiscussionMessage[]>(
              ['discussion-messages', spaceId, selectedThreadId],
              (prev = []) => {
                const duplicated = prev.some((item) => {
                  const itemId = String(item.id || '').trim();
                  const incomingId = String(incoming.id || '').trim();
                  if (itemId && incomingId) {
                    return itemId === incomingId;
                  }
                  return (
                    item.sequence === incoming.sequence &&
                    item.participantId === incoming.participantId &&
                    item.senderType === incoming.senderType
                  );
                });
                if (duplicated) {
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
  }, [addRunningAgentParticipants, queryClient, removeRunningAgentParticipants, selectedThreadId, spaceId]);

  useEffect(() => {
    return () => {
      sedimentTaskUnsubscribeRef.current?.();
      sedimentTaskUnsubscribeRef.current = null;
      outlineTaskUnsubscribeRef.current?.();
      outlineTaskUnsubscribeRef.current = null;
      for (const timer of runningAgentTimeoutsRef.current.values()) {
        window.clearTimeout(timer);
      }
      runningAgentTimeoutsRef.current.clear();
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
  const isSpaceArchived = detail.status === 'archived';
  const toRequirementThreadTitle = toRequirementMessage
    ? detail.threadTree.find((thread) => thread.id === toRequirementMessage.threadId)?.title || selectedThread?.title || ''
    : '';

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
              <span className={`px-2 py-1 text-[11px] ${isSpaceArchived ? 'bg-[#fff1f1] text-[#a2191f]' : 'bg-[#f4f4f4] text-[#525252]'}`}>
                {spaceStatusLabelMap[detail.status] || detail.status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isSpaceArchived ? (
                <button
                  type="button"
                  onClick={() => unarchiveSpaceMutation.mutate()}
                  disabled={unarchiveSpaceMutation.isLoading}
                  className="inline-flex items-center gap-1 border border-[#0f62fe] px-3 py-2 text-xs text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  取消归档
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => archiveSpaceMutation.mutate()}
                  disabled={archiveSpaceMutation.isLoading}
                  className="inline-flex items-center gap-1 border border-[#a8a8a8] px-3 py-2 text-xs text-[#525252] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  归档
                </button>
              )}
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
                {runningAgents.length ? (
                  <div className="flex items-center gap-2">
                    {runningAgents.map((participant) => (
                      <span
                        key={participant.id}
                        className="inline-flex items-center gap-1 border border-[#78a9ff] bg-[#edf5ff] px-2 py-1 text-[11px] text-[#0043ce]"
                      >
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#0f62fe]" />
                        {participant.displayName} 执行中
                      </span>
                    ))}
                  </div>
                ) : null}
                {selectedThread?.outlineSectionId ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (enrichCurrentSectionMutation.isLoading || sendMessageMutation.isLoading || injectOutlineMessageMutation.isLoading) {
                        return;
                      }
                      if (isSpaceArchived) {
                        setActionError('该讨论空间已归档，当前只读。');
                        return;
                      }
                      if (!currentParticipant) {
                        setActionError('当前空间暂无可用参与者，无法发起章节补充');
                        return;
                      }
                      setActionError('');
                      setActionNotice('');
                      enrichCurrentSectionMutation.mutate();
                    }}
                    disabled={
                      enrichCurrentSectionMutation.isLoading ||
                      sendMessageMutation.isLoading ||
                      injectOutlineMessageMutation.isLoading ||
                      isSpaceArchived
                    }
                    className="border border-[#0f62fe] px-2 py-1 text-xs text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {enrichCurrentSectionMutation.isLoading ? '丰富中...' : '丰富此章节'}
                  </button>
                ) : null}
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
                  generatedKnowledgeEntries={(message.metadata?.generatedKnowledgeEntryIds || [])
                    .map((id) => knowledgeEntryMap.get(id))
                    .filter((item): item is DiscussionKnowledgeEntry => Boolean(item))}
                  deletingKnowledgeEntryId={
                    deleteKnowledgeEntryMutation.isLoading ? deleteKnowledgeEntryMutation.variables?.id : undefined
                  }
                  onDeleteGeneratedKnowledge={handleDeleteGeneratedKnowledge}
                  onBranch={handleBranch}
                  onArchiveKnowledge={handleOpenArchiveKnowledge}
                  onToRequirement={handleOpenToRequirement}
                />
              ))}
            </div>

            <MessageInput
              value={messageText}
              sending={sendMessageMutation.isLoading}
              injectingOutline={injectOutlineMessageMutation.isLoading}
              disableInjectOutline={!sortedOutlineSections.length}
              disabled={isSpaceArchived}
              disabledReason="该讨论空间已归档，当前只读。请先取消归档后再发送消息。"
              projectId={detail.projectId}
              participants={participants}
              onChange={setMessageText}
              onSend={(dataReferences) => {
                if (isSpaceArchived) {
                  setActionError('该讨论空间已归档，当前只读。');
                  return;
                }
                if (!selectedThreadId) {
                  setActionError('请先选择讨论线');
                  return;
                }
                if (!currentParticipant) {
                  setActionError('当前空间暂无可用参与者，无法发送消息');
                  return;
                }
                sendMessageMutation.mutate(dataReferences);
              }}
              onInjectOutline={() => {
                if (isSpaceArchived) {
                  setActionError('该讨论空间已归档，当前只读。');
                  return;
                }
                if (!selectedThreadId) {
                  setActionError('请先选择讨论线');
                  return;
                }
                if (!currentParticipant) {
                  setActionError('当前空间暂无可用参与者，无法发送消息');
                  return;
                }
                if (!sortedOutlineSections.length) {
                  setActionError('当前暂无可注入的大纲');
                  return;
                }
                setActionError('');
                injectOutlineMessageMutation.mutate();
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
                  selectedOutlineSectionId={knowledgeOutlineSectionId}
                  loading={knowledgeQuery.isLoading}
                  items={knowledgeQuery.data || []}
                  outlineSections={sortedOutlineSections}
                  onKeywordChange={(value) => setKnowledgeKeyword(spaceId, value)}
                  onOutlineSectionChange={setKnowledgeOutlineSectionId}
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
                  generating={generateOutlineMutation.isLoading || isOutlineStreaming}
                  onGenerate={() => generateOutlineMutation.mutate()}
                  templates={outlineTemplatesQuery.data || []}
                  selectedTemplateId={selectedOutlineTemplateId}
                  onTemplateChange={setSelectedOutlineTemplateId}
                  applyingTemplate={applyOutlineTemplateMutation.isLoading}
                  onApplyTemplate={() => applyOutlineTemplateMutation.mutate()}
                  onDiscussSection={(section) => {
                    if (openSectionThreadMutation.isLoading || isOutlineStreaming || enrichAllOutlineSectionsMutation.isLoading) {
                      return;
                    }
                    setActionError('');
                    setActionNotice('');
                    openSectionThreadMutation.mutate({ section, triggerEnrich: false });
                  }}
                  discussingSectionId={
                    openSectionThreadMutation.isLoading ? openSectionThreadMutation.variables?.section.id : undefined
                  }
                  onEnrichAllSections={() => {
                    if (enrichAllOutlineSectionsMutation.isLoading || isOutlineStreaming) {
                      return;
                    }
                    setActionError('');
                    setActionNotice('');
                    enrichAllOutlineSectionsMutation.mutate();
                  }}
                  enrichingAllSections={enrichAllOutlineSectionsMutation.isLoading}
                  onAddSection={() => {
                    if (addOutlineSectionMutation.isLoading || isOutlineStreaming) {
                      return;
                    }
                    openCreateOutlineSectionModal();
                  }}
                  onAddChildSection={(section) => {
                    if (addOutlineSectionMutation.isLoading || isOutlineStreaming) {
                      return;
                    }
                    openCreateOutlineSectionModal(section.id);
                  }}
                  addingSection={addOutlineSectionMutation.isLoading}
                  onEditSection={(section) => {
                    if (editOutlineSectionMutation.isLoading || isOutlineStreaming) {
                      return;
                    }
                    openEditOutlineSectionModal(section);
                  }}
                  editingSectionId={
                    editOutlineSectionMutation.isLoading ? editOutlineSectionMutation.variables?.sectionId : undefined
                  }
                  onDeleteSection={(section) => {
                    if (clearOutlineSectionEnrichmentMutation.isLoading || isOutlineStreaming) {
                      return;
                    }
                    handleClearOutlineSectionEnrichment(section);
                  }}
                  deletingSectionId={
                    clearOutlineSectionEnrichmentMutation.isLoading ? clearOutlineSectionEnrichmentMutation.variables?.id : undefined
                  }
                  onMoveSection={(section, direction) => {
                    if (moveOutlineSectionMutation.isLoading || isOutlineStreaming) {
                      return;
                    }
                    handleMoveOutlineSection(section, direction);
                  }}
                  movingSectionId={
                    moveOutlineSectionMutation.isLoading ? moveOutlineSectionMutation.variables?.sectionId : undefined
                  }
                  onGoDataDashboard={() => {
                    const projectId = String(detail.projectId || '').trim();
                    if (!projectId) {
                      setActionError('当前讨论空间未关联项目，无法跳转数据看板');
                      return;
                    }
                    navigate(`/ei/incubation/${encodeURIComponent(projectId)}/data?prefill=1`);
                  }}
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
                  autoAnalysisOnDataUpdate={detail.settings?.autoAnalysisOnDataUpdate}
                  addingAgent={addParticipantMutation.isLoading || assignableAgentsQuery.isLoading}
                  updatingAutoAnalysis={updateAutoAnalysisOnDataUpdateMutation.isLoading}
                  removingParticipantId={
                    typeof removeParticipantMutation.variables === 'string' ? removeParticipantMutation.variables : undefined
                  }
                  onSelectAgent={setSelectedAgentId}
                  onDefaultReplyAgentChange={(participantId) => updateDefaultReplyAgentMutation.mutate(participantId)}
                  onAutoAnalysisOnDataUpdateChange={(enabled) => updateAutoAnalysisOnDataUpdateMutation.mutate(enabled)}
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
        sourceSpaceTitle={detail.title}
        sourceThreadTitle={toRequirementThreadTitle}
        sourceMessageId={toRequirementMessage?.id}
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

      <OutlineSectionModal
        open={outlineSectionModalOpen}
        mode={outlineSectionModalMode}
        title={outlineSectionTitle}
        description={outlineSectionDescription}
        status={outlineSectionStatus}
        parentSectionId={outlineSectionParentId}
        parentOptions={outlineSectionParentOptions}
        submitting={addOutlineSectionMutation.isLoading || editOutlineSectionMutation.isLoading}
        onClose={() => {
          if (addOutlineSectionMutation.isLoading || editOutlineSectionMutation.isLoading) {
            return;
          }
          closeOutlineSectionModal();
        }}
        onTitleChange={setOutlineSectionTitle}
        onDescriptionChange={setOutlineSectionDescription}
        onStatusChange={setOutlineSectionStatus}
        onParentSectionIdChange={setOutlineSectionParentId}
        onSubmit={handleSubmitOutlineSectionModal}
      />
      </div>
    </div>
  );
};

export default DiscussionDetail;
