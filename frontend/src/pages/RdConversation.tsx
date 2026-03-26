import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'react-query';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import { rdConversationService, OpencodeCurrentContext, OpencodeEventPayload, RdProject } from '../services/rdConversationService';

type ViewTab = 'chat' | 'events';

type ChatBlock = {
  type: 'text' | 'tool' | 'meta';
  content: string;
  title?: string;
};

function resolveMessageRole(message: any): 'user' | 'assistant' | 'system' | 'tool' {
  const roleCandidates = [message?.role, message?.info?.role, message?.metadata?.role, message?.type];
  for (const candidate of roleCandidates) {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (normalized === 'user') return 'user';
    if (normalized === 'assistant') return 'assistant';
    if (normalized === 'system') return 'system';
    if (normalized === 'tool') return 'tool';
  }
  return 'assistant';
}

function shouldClampTextContent(text: string): boolean {
  if (!text) return false;
  return text.length > 360 || text.split('\n').length > 10;
}

function getMessageStableId(message: any, index: number): string {
  if (typeof message?.id === 'string' && message.id.trim()) return message.id;
  if (typeof message?._id === 'string' && message._id.trim()) return message._id;
  if (typeof message?.messageId === 'string' && message.messageId.trim()) return message.messageId;
  return `${message?.timestamp || message?.createdAt || 'no-time'}-${message?.sequence ?? index}`;
}

function getMessageTime(message: any): number {
  const sequence = Number(message?.sequence);
  if (Number.isFinite(sequence)) {
    return sequence;
  }
  const time = new Date(message?.timestamp || message?.createdAt || message?.updatedAt || 0).getTime();
  if (Number.isFinite(time) && time > 0) {
    return time;
  }
  return 0;
}

function truncateText(value: string, max = 160): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function stringifyCompact(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function tryParseJsonString(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const text = input.trim();
  if (!text) return '';
  if (!(text.startsWith('{') || text.startsWith('['))) return input;
  try {
    return JSON.parse(text);
  } catch {
    return input;
  }
}

function formatToolInput(input: any): string {
  const normalizedInput = tryParseJsonString(input);
  if (normalizedInput === null || normalizedInput === undefined) return '';
  if (normalizedInput === '') return '';
  if (typeof normalizedInput === 'object' && !Array.isArray(normalizedInput)) {
    const nested =
      (normalizedInput as Record<string, unknown>).input ??
      (normalizedInput as Record<string, unknown>).arguments ??
      (normalizedInput as Record<string, unknown>).args ??
      (normalizedInput as Record<string, unknown>).params ??
      (normalizedInput as Record<string, unknown>).parameters ??
      (normalizedInput as Record<string, unknown>).payload;
    if (nested && nested !== normalizedInput) {
      return formatToolInput(nested);
    }
  }
  if (typeof normalizedInput === 'string') return truncateText(normalizedInput);
  if (typeof normalizedInput !== 'object' || Array.isArray(normalizedInput)) {
    return truncateText(String(normalizedInput));
  }

  const preferredKeys = [
    'filePath',
    'path',
    'pattern',
    'include',
    'directory',
    'workdir',
    'query',
    'url',
    'command',
    'sessionId',
  ];

  const parts: string[] = [];
  for (const key of preferredKeys) {
    const value = (normalizedInput as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${truncateText(stringifyCompact(value), 120)}`);
    if (parts.length >= 4) break;
  }

  if (parts.length > 0) {
    return parts.join(' ');
  }
  return truncateText(stringifyCompact(normalizedInput), 160);
}

function extractToolCallId(part: any): string {
  const candidates = [
    part?.toolCallId,
    part?.tool_call_id,
    part?.callId,
    part?.id,
    part?.state?.toolCallId,
    part?.metadata?.toolCallId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function extractToolInputFromPart(part: any): string {
  const direct = formatToolInput(
    part?.input ??
      part?.args ??
      part?.arguments ??
      part?.params ??
      part?.parameters ??
      part?.payload ??
      part?.data ??
      part?.state?.input,
  );
  if (direct) return direct;

  const fallback = formatToolInput(part);
  if (fallback && fallback !== 'tool') return fallback;
  return '';
}

function extractChatBlocks(message: any): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const toolIndexByCallId = new Map<string, number>();
  const info =
    message?.info && typeof message.info === 'object' && !Array.isArray(message.info)
      ? (message.info as Record<string, any>)
      : undefined;
  const partSources = [
    message?.parts,
    message?.info?.parts,
    message?.content?.parts,
    message?.info?.content?.parts,
    message?.payload?.parts,
    message?.data?.parts,
    Array.isArray(message?.content) ? message.content : undefined,
  ];
  const parts = partSources.filter((item) => Array.isArray(item)).flat() as any[];

  if (Array.isArray(parts) && parts.length > 0) {
    parts.forEach((part: any) => {
      const partType = String(part?.type || '').toLowerCase();

      if (partType === 'text' || partType === 'reasoning') {
        const content =
          (typeof part?.text === 'string' && part.text.trim()) ||
          (typeof part?.content === 'string' && part.content.trim()) ||
          (typeof part?.value === 'string' && part.value.trim()) ||
          '';
        if (content) {
          blocks.push({ type: 'text', content });
        }
        return;
      }

      if (partType === 'tool_call' || partType === 'tool-call' || partType === 'tool') {
        const toolName =
          (typeof part?.toolName === 'string' && part.toolName.trim()) ||
          (typeof part?.tool === 'string' && part.tool.trim()) ||
          (typeof part?.name === 'string' && part.name.trim()) ||
          (typeof part?.toolId === 'string' && part.toolId.trim()) ||
          (typeof part?.id === 'string' && part.id.trim()) ||
          'tool';
        const toolCallId = extractToolCallId(part);
        const inputText = extractToolInputFromPart(part);
        blocks.push({
          type: 'tool',
          title: toolName,
          content: inputText,
        });
        if (toolCallId) {
          toolIndexByCallId.set(toolCallId, blocks.length - 1);
        }
        return;
      }

      if (partType === 'tool_result' || partType === 'tool-result' || partType === 'system_event') {
        const toolCallId = extractToolCallId(part);
        if (toolCallId && toolIndexByCallId.has(toolCallId)) {
          const targetIndex = toolIndexByCallId.get(toolCallId)!;
          const current = blocks[targetIndex];
          if (current && current.type === 'tool' && !current.content) {
            const resultInput = formatToolInput(part?.input ?? part?.state?.input ?? part?.payload?.input);
            if (resultInput) {
              current.content = resultInput;
            }
          }
        }

        const resultText =
          (typeof part?.content === 'string' && part.content.trim()) ||
          (typeof part?.output === 'string' && part.output.trim()) ||
          '';
        if (resultText) {
          blocks.push({ type: 'meta', content: truncateText(resultText, 220) });
          return;
        }

        const structuredOutput = part?.output ?? part?.result;
        if (structuredOutput !== undefined && structuredOutput !== null) {
          blocks.push({ type: 'meta', content: truncateText(stringifyCompact(structuredOutput), 220) });
        }
      }
    });
  }

  if (blocks.length === 0) {
    const fallbackCandidates = [
      message?.content,
      message?.text,
      info?.content,
      info?.text,
      info?.summary,
      info?.message,
      info?.output,
      message?.response,
      message?.output,
      message?.result,
      message?.error,
      message?.metadata?.content,
    ];

    for (const candidate of fallbackCandidates) {
      const text = stringifyCompact(candidate);
      if (!text) continue;
      blocks.push({ type: 'text', content: text });
      break;
    }
  }

  if (blocks.length === 0) {
    const role = typeof info?.role === 'string' ? info.role : typeof message?.role === 'string' ? message.role : '';
    const providerID = typeof info?.providerID === 'string' ? info.providerID : typeof message?.providerID === 'string' ? message.providerID : '';
    const modelID = typeof info?.modelID === 'string' ? info.modelID : typeof message?.modelID === 'string' ? message.modelID : '';
    const mode = typeof info?.mode === 'string' ? info.mode : typeof message?.mode === 'string' ? message.mode : '';
    const metaLine = [
      role && `role=${role}`,
      providerID && `provider=${providerID}`,
      modelID && `model=${modelID}`,
      mode && `mode=${mode}`,
    ]
      .filter(Boolean)
      .join(' ');

    if (metaLine) {
      blocks.push({ type: 'meta', content: metaLine });
    }
  }

  if (blocks.length === 0) {
    const fallback = extractMessageText(message);
    if (fallback.trim()) {
      blocks.push({ type: 'text', content: fallback });
    }
  }

  if (blocks.length === 0) {
    try {
      blocks.push({ type: 'meta', content: truncateText(JSON.stringify(message, null, 2), 260) });
    } catch {
      blocks.push({ type: 'meta', content: '(无法解析消息内容)' });
    }
  }

  return blocks;
}

function extractMessageText(message: any): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (typeof message.text === 'string') return message.text;
  if (message.info?.content) return message.info.content;

  const parts = message.parts || message.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((part) => {
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return JSON.stringify(message);
}

function getEventGroup(type?: string): 'tool' | 'prompt' | 'command' | 'error' | 'other' {
  const v = (type || '').toLowerCase();
  if (v.includes('tool')) return 'tool';
  if (v.includes('text') || v.includes('reason')) return 'prompt';
  if (v.includes('prompt') || v.includes('message')) return 'prompt';
  if (v.includes('command')) return 'command';
  if (v.includes('error') || v.includes('fail')) return 'error';
  return 'other';
}

function toEventTime(value: any): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return undefined;
}

function formatEventTitle(event: OpencodeEventPayload): string {
  const type = String(event?.type || 'event').trim();
  const part = event?.properties?.part;
  const toolName =
    (typeof part?.toolName === 'string' && part.toolName.trim()) ||
    (typeof part?.toolId === 'string' && part.toolId.trim()) ||
    (typeof part?.tool === 'string' && part.tool.trim()) ||
    '';
  if (toolName) {
    return `${type} · ${toolName}`;
  }

  const textCandidate =
    (typeof part?.text === 'string' && part.text.trim()) ||
    (typeof part?.content === 'string' && part.content.trim()) ||
    (typeof event?.message === 'string' && event.message.trim()) ||
    '';
  if (textCandidate) {
    return `${type} · ${truncateText(textCandidate.replace(/\s+/g, ' '), 80)}`;
  }
  return type;
}

function resolveEventSessionId(event: OpencodeEventPayload): string {
  const properties =
    event?.properties && typeof event.properties === 'object' && !Array.isArray(event.properties)
      ? (event.properties as Record<string, any>)
      : undefined;
  const info =
    properties?.info && typeof properties.info === 'object' && !Array.isArray(properties.info)
      ? (properties.info as Record<string, any>)
      : undefined;
  const part =
    properties?.part && typeof properties.part === 'object' && !Array.isArray(properties.part)
      ? (properties.part as Record<string, any>)
      : undefined;
  const status =
    properties?.status && typeof properties.status === 'object' && !Array.isArray(properties.status)
      ? (properties.status as Record<string, any>)
      : undefined;

  const candidates = [
    event?.sessionId,
    event?.sessionID,
    event?.session_id,
    event?.path?.id,
    event?.meta?.sessionId,
    event?.metadata?.sessionId,
    event?.properties?.sessionId,
    event?.properties?.sessionID,
    event?.properties?.session_id,
    info?.sessionId,
    info?.sessionID,
    info?.session_id,
    part?.sessionId,
    part?.sessionID,
    part?.session_id,
    status?.sessionId,
    status?.sessionID,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function resolveEventProjectPath(event: OpencodeEventPayload): string {
  const properties =
    event?.properties && typeof event.properties === 'object' && !Array.isArray(event.properties)
      ? (event.properties as Record<string, any>)
      : undefined;
  const info =
    properties?.info && typeof properties.info === 'object' && !Array.isArray(properties.info)
      ? (properties.info as Record<string, any>)
      : undefined;

  const candidates = [
    event?.path,
    event?.projectPath,
    event?.worktree,
    event?.cwd,
    event?.root,
    event?.directory,
    event?.project?.path,
    event?.properties?.path,
    event?.properties?.projectPath,
    event?.properties?.directory,
    event?.properties?.worktree,
    event?.properties?.cwd,
    info?.path,
    info?.projectPath,
    info?.worktree,
    info?.cwd,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }
  return '';
}

function extractRequestErrorMessage(error: any): string {
  const candidates = [
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '请求失败，请稍后重试';
}

const RdConversation: React.FC = () => {
  const [viewTab, setViewTab] = useState<ViewTab>('chat');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedProjectPath, setSelectedProjectPath] = useState('');
  const [selectedEiProjectId, setSelectedEiProjectId] = useState('');
  const [promptText, setPromptText] = useState('');
  const [events, setEvents] = useState<OpencodeEventPayload[]>([]);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<string, boolean>>({});
  const [collapsedChildListIds, setCollapsedChildListIds] = useState<Record<string, boolean>>({});
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});
  const [selectedEventTab, setSelectedEventTab] = useState<'tool' | 'prompt' | 'command' | 'error' | 'other'>('tool');
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: currentContext, refetch: refetchContext } = useQuery<OpencodeCurrentContext>(
    'rd-opencode-current',
    () => rdConversationService.getCurrentOpencodeContext(),
    { refetchInterval: 15000, retry: false }
  );

  const { data: sessions = [], refetch: refetchSessions } = useQuery(
    [
      'rd-opencode-sessions',
      selectedProjectPath,
    ],
    () => rdConversationService.getOpencodeSessions(selectedProjectPath || undefined),
    { enabled: !!selectedProjectPath, refetchInterval: 10000, retry: false }
  );

  const { data: localProjects = [], refetch: refetchLocalProjects } = useQuery<RdProject[]>(
    ['rd-opencode-projects'],
    () => rdConversationService.getProjects({ sourceType: 'opencode' }),
    { retry: false }
  );

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId('');
      return;
    }

    const exists = sessions.some((item: any) => (item.id || item._id) === selectedSessionId);
    if (!exists) {
      setSelectedSessionId(sessions[0].id || sessions[0]._id || '');
    }
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (!selectedProjectPath) {
      const path = currentContext?.path?.cwd || currentContext?.project?.path || '';
      if (path) setSelectedProjectPath(path);
    }
  }, [currentContext, selectedProjectPath]);

  const { data: sessionDetail } = useQuery(
    ['rd-opencode-session-detail', selectedSessionId],
    () => rdConversationService.getOpencodeSession(selectedSessionId),
    { enabled: !!selectedSessionId, retry: false }
  );

  const { data: sessionMessages = [], refetch: refetchMessages, isLoading: messagesLoading } = useQuery(
    ['rd-opencode-session-messages', selectedSessionId],
    () => rdConversationService.getOpencodeSessionMessages(selectedSessionId),
    { enabled: !!selectedSessionId, refetchInterval: 5000, refetchOnWindowFocus: false, retry: false }
  );

  const promptMutation = useMutation(
    () =>
      rdConversationService.promptOpencodeSession(
        selectedSessionId,
        promptText,
        undefined,
      ),
    {
      onSuccess: async () => {
        setPromptText('');
        await refetchMessages();
        await refetchSessions();
      },
      onError: (error) => {
        alert(extractRequestErrorMessage(error));
      },
    }
  );

  const createSessionMutation = useMutation(
    () =>
      rdConversationService.createOpencodeSession({
        projectPath: selectedProjectPath,
        title: newSessionTitle.trim() || undefined,
      }),
    {
      onSuccess: async (createdSession) => {
        const createdSessionId = createdSession?.id || createdSession?._id || '';
        if (createdSessionId) {
          setSelectedSessionId(createdSessionId);
        }
        setNewSessionTitle('');
        await Promise.all([refetchSessions(), refetchContext(), refetchMessages()]);
      },
      onError: (error) => {
        alert(extractRequestErrorMessage(error));
      },
    },
  );

  useEffect(() => {
    const source = rdConversationService.subscribeOpencodeEvents((event) => {
      setEvents((prev) => [event, ...prev].slice(0, 200));
    });
    return () => source.close();
  }, []);

  const normalizedSessionMessages = useMemo(() => {
    if (!Array.isArray(sessionMessages)) {
      return [] as any[];
    }
    return [...sessionMessages].sort((a: any, b: any) => getMessageTime(a) - getMessageTime(b));
  }, [sessionMessages]);

  const derivedEventsFromMessages = useMemo<OpencodeEventPayload[]>(() => {
    if (!selectedSessionId || !Array.isArray(normalizedSessionMessages) || normalizedSessionMessages.length === 0) {
      return [];
    }

    const eventsFromMessages: OpencodeEventPayload[] = [];
    normalizedSessionMessages.forEach((message: any, messageIndex: number) => {
      const partSources = [
        message?.parts,
        message?.info?.parts,
        message?.content?.parts,
        message?.info?.content?.parts,
        message?.payload?.parts,
        message?.data?.parts,
      ];
      const parts = partSources.filter((item) => Array.isArray(item)).flat() as any[];
      if (parts.length === 0) return;

      const messageTime =
        toEventTime(message?.timestamp) ||
        toEventTime(message?.createdAt) ||
        toEventTime(message?.updatedAt) ||
        toEventTime(message?.info?.time?.completed) ||
        toEventTime(message?.info?.time?.created) ||
        new Date().toISOString();

      parts.forEach((part: any, partIndex: number) => {
        const partType = String(part?.type || 'part').toLowerCase();
        eventsFromMessages.push({
          type: `derived.${partType}`,
          sessionId: selectedSessionId,
          timestamp: messageTime,
          properties: {
            part,
            path: selectedProjectPath || undefined,
            messageId: getMessageStableId(message, messageIndex),
            index: partIndex,
          },
        });
      });
    });

    return eventsFromMessages.slice(-200).reverse();
  }, [normalizedSessionMessages, selectedProjectPath, selectedSessionId]);

  const mergedEvents = useMemo(() => {
    if (events.length === 0) {
      return derivedEventsFromMessages;
    }
    return [...events, ...derivedEventsFromMessages];
  }, [events, derivedEventsFromMessages]);

  useEffect(() => {
    if (localProjects.length === 0) {
      setSelectedEiProjectId('');
      return;
    }
    const exists = localProjects.some((item) => item._id === selectedEiProjectId);
    if (!exists) {
      setSelectedEiProjectId(localProjects[0]._id);
    }
  }, [localProjects, selectedEiProjectId]);

  useEffect(() => {
    const selectedProject = localProjects.find((item) => item._id === selectedEiProjectId);
    if (selectedProject?.opencodeProjectPath) {
      setSelectedProjectPath(selectedProject.opencodeProjectPath);
      return;
    }
    if (!selectedProjectPath) {
      const path = currentContext?.path?.cwd || currentContext?.project?.path || '';
      if (path) setSelectedProjectPath(path);
    }
  }, [selectedEiProjectId, localProjects, currentContext, selectedProjectPath]);

  const groupedEvents = useMemo(() => {
    const normalizedPath = selectedProjectPath.trim().toLowerCase();
    const filteredEvents = mergedEvents.filter((event) => {
      const eventSessionId = resolveEventSessionId(event);
      if (selectedSessionId) {
        if (!eventSessionId) {
          return true;
        }
        return eventSessionId === selectedSessionId;
      }
      if (!normalizedPath) {
        return true;
      }
      const eventPath = resolveEventProjectPath(event);
      if (!eventPath) {
        return true;
      }
      return eventPath.includes(normalizedPath) || normalizedPath.includes(eventPath);
    });

    const groups: Record<string, OpencodeEventPayload[]> = { tool: [], prompt: [], command: [], error: [], other: [] };
    filteredEvents.forEach((event) => {
      groups[getEventGroup(event.type)].push(event);
    });
    return groups;
  }, [mergedEvents, selectedSessionId, selectedProjectPath]);

  useEffect(() => {
    const order: Array<'tool' | 'prompt' | 'command' | 'error' | 'other'> = ['tool', 'prompt', 'command', 'error', 'other'];
    if ((groupedEvents[selectedEventTab] || []).length > 0) {
      return;
    }
    const firstNonEmpty = order.find((key) => (groupedEvents[key] || []).length > 0);
    if (firstNonEmpty && firstNonEmpty !== selectedEventTab) {
      setSelectedEventTab(firstNonEmpty);
    }
  }, [groupedEvents, selectedEventTab]);

  const refreshAll = async () => {
    await Promise.all([refetchContext(), refetchSessions(), refetchMessages(), refetchLocalProjects()]);
  };

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col gap-4">
      <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex flex-wrap items-center gap-2">
        <select
          value={selectedEiProjectId}
          onChange={(e) => setSelectedEiProjectId(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 min-w-[260px]"
        >
          <option value="">选择 OpenCode Project</option>
          {localProjects.map((project) => (
            <option key={project._id} value={project._id}>
              {`${project.name} (${project.opencodeProjectPath || '-'})`}
            </option>
          ))}
        </select>
        <button
          onClick={() => window.open('/agent-task-runner', '_blank', 'noopener,noreferrer')}
          className="px-2 py-1 text-xs rounded text-gray-700 hover:bg-gray-100 border border-gray-200 disabled:text-gray-400 disabled:bg-gray-50"
          title="在新标签页打开 Agent任务流"
        >
          <span className="inline-flex items-center gap-1">测试 Opencode SSE</span>
        </button>
        <button onClick={refreshAll} className="text-gray-500 hover:text-gray-700 ml-auto">
          <ArrowPathIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 flex-1">
      <aside className="lg:col-span-3 bg-white border border-gray-200 rounded-lg flex flex-col min-h-0">
        <div className="p-3 border-b border-gray-200 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">OpenCode Sessions</p>
        </div>

        <div className="px-3 py-2 border-b border-gray-200 space-y-2">
          <input
            value={newSessionTitle}
            onChange={(e) => setNewSessionTitle(e.target.value)}
            placeholder="新建 Session 标题（可选）"
            className="w-full px-2 py-1 text-xs rounded border border-gray-300"
          />
          <button
            onClick={() => createSessionMutation.mutate()}
            disabled={!selectedProjectPath || createSessionMutation.isLoading}
            className="w-full text-xs rounded border border-primary-200 bg-primary-50 text-primary-700 px-2 py-1 disabled:text-gray-400 disabled:bg-gray-50 disabled:border-gray-200"
          >
            新建 Session
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((session: any) => {
            const sid = session.id || session._id;
            const active = sid === selectedSessionId;
            return (
              <button
                key={sid}
                onClick={() => setSelectedSessionId(sid)}
                className={`w-full text-left px-2 py-2 rounded border ${active ? 'border-primary-500 bg-primary-50' : 'border-transparent hover:bg-gray-50'}`}
              >
                <p className="text-sm font-medium text-gray-900 truncate">{session.title || sid}</p>
                <p className="text-xs text-gray-500 truncate">{sid}</p>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="lg:col-span-9 bg-white border border-gray-200 rounded-lg flex flex-col min-h-0 relative">
        <div className="p-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">{sessionDetail?.title || selectedSessionId || '未选择 Session'}</p>
            <p className="text-xs text-gray-500">Project: {selectedProjectPath || currentContext?.path?.cwd || currentContext?.project?.path || '-'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewTab('chat')}
              className={`px-2 py-1 text-xs rounded ${viewTab === 'chat' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <span className="inline-flex items-center gap-1"><ChatBubbleLeftRightIcon className="h-4 w-4" />Chat</span>
            </button>
            <button
              onClick={() => setViewTab('events')}
              className={`px-2 py-1 text-xs rounded ${viewTab === 'events' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <span className="inline-flex items-center gap-1"><SignalIcon className="h-4 w-4" />Events</span>
            </button>
          </div>
        </div>

        {viewTab === 'chat' ? (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messagesLoading ? (
                <p className="text-sm text-gray-500">加载消息中...</p>
              ) : normalizedSessionMessages.length === 0 ? (
                <p className="text-sm text-gray-400">该 session 暂无消息</p>
              ) : (
                normalizedSessionMessages.map((message: any, idx: number) => {
                  const messageId = getMessageStableId(message, idx);
                  const role = resolveMessageRole(message);
                  const isUser = role === 'user';
                  const blocks = extractChatBlocks(message);
                  const textBlocks = blocks.filter((block) => block.type === 'text');
                  const childBlocks = blocks.filter((block) => block.type !== 'text');
                  const combinedText = textBlocks.map((block) => block.content).join('\n\n').trim();
                  const canClampMessage = shouldClampTextContent(combinedText);
                  const isMessageExpanded = !!expandedMessageIds[messageId];
                  const isChildListCollapsed = !!collapsedChildListIds[messageId];
                  return (
                    <div key={messageId} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[88%] rounded-lg px-3 py-2 ${isUser ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                        {blocks.length === 0 ? (
                          <p className="text-sm opacity-70">(空消息)</p>
                        ) : (
                          <div className="space-y-2">
                            {combinedText ? (
                              <>
                                <pre
                                  className="whitespace-pre-wrap text-sm font-sans"
                                  style={
                                    canClampMessage && !isMessageExpanded
                                      ? {
                                          display: '-webkit-box',
                                          WebkitLineClamp: 10,
                                          WebkitBoxOrient: 'vertical',
                                          overflow: 'hidden',
                                        }
                                      : undefined
                                  }
                                >
                                  {combinedText}
                                </pre>
                                {canClampMessage ? (
                                  <button
                                    onClick={() =>
                                      setExpandedMessageIds((prev) => ({
                                        ...prev,
                                        [messageId]: !prev[messageId],
                                      }))
                                    }
                                    className={`text-xs font-medium ${isUser ? 'text-blue-100 hover:text-white' : 'text-primary-600 hover:text-primary-700'}`}
                                  >
                                    {isMessageExpanded ? '折叠消息' : '展开消息'}
                                  </button>
                                ) : null}
                              </>
                            ) : null}

                            {childBlocks.length > 0 ? (
                              <div className="space-y-2">
                                <button
                                  onClick={() =>
                                    setCollapsedChildListIds((prev) => ({
                                      ...prev,
                                      [messageId]: !prev[messageId],
                                    }))
                                  }
                                  className={`text-xs font-medium ${isUser ? 'text-blue-100 hover:text-white' : 'text-gray-600 hover:text-gray-800'}`}
                                >
                                  {isChildListCollapsed ? `展开子消息 (${childBlocks.length})` : `折叠子消息 (${childBlocks.length})`}
                                </button>

                                {!isChildListCollapsed
                                  ? childBlocks.map((block, blockIdx) => {
                                      if (block.type === 'tool') {
                                        return (
                                          <div key={`${messageId}-tool-${blockIdx}`} className={`rounded border px-2 py-1.5 text-xs ${isUser ? 'border-blue-300/60 bg-blue-500/30' : 'border-gray-300 bg-white/80 text-gray-700'}`}>
                                            <div className="font-mono font-semibold">{block.title || 'tool'}</div>
                                            {block.content ? (
                                              <div className={`mt-1 break-words font-mono ${isUser ? 'text-blue-100' : 'text-gray-500'}`}>{block.content}</div>
                                            ) : null}
                                          </div>
                                        );
                                      }
                                      return (
                                        <p key={`${messageId}-meta-${blockIdx}`} className={`text-xs ${isUser ? 'text-blue-100' : 'text-gray-500'}`}>
                                          {block.content}
                                        </p>
                                      );
                                    })
                                  : null}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {!isComposerOpen ? (
              <button
                onClick={() => setIsComposerOpen(true)}
                className="absolute bottom-4 right-4 h-12 w-12 rounded-full bg-primary-600 text-white shadow-lg hover:bg-primary-700 flex items-center justify-center"
                title="打开消息输入框"
                aria-label="打开消息输入框"
              >
                <ChatBubbleLeftRightIcon className="h-5 w-5" />
              </button>
            ) : (
              <div className="absolute bottom-4 right-4 w-[min(520px,calc(100%-2rem))] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-600">发送消息到当前 Session</p>
                  <button
                    onClick={() => setIsComposerOpen(false)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="关闭消息输入框"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && selectedSessionId) {
                      promptMutation.mutate();
                    }
                  }}
                  placeholder="输入消息后发送到当前 session（Cmd/Ctrl+Enter）"
                  className="w-full min-h-[96px] border border-gray-300 rounded px-3 py-2 text-sm"
                />
                <div className="mt-2 flex justify-end">
                <button
                  onClick={() => promptMutation.mutate()}
                  disabled={!selectedSessionId || !promptText.trim() || promptMutation.isLoading}
                  className="text-sm rounded bg-primary-600 text-white px-4 py-2 disabled:bg-gray-300"
                >
                  发送到 Session
                </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 min-h-0 p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {(['tool', 'prompt', 'command', 'error', 'other'] as const).map((group) => {
                const active = selectedEventTab === group;
                return (
                  <button
                    key={group}
                    onClick={() => setSelectedEventTab(group)}
                    className={`px-3 py-1.5 text-xs rounded border ${active ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {group.toUpperCase()} ({groupedEvents[group].length})
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 border border-gray-200 rounded-lg">
              <div className="px-3 py-2 border-b border-gray-200 text-sm font-medium text-gray-900">
                {selectedEventTab.toUpperCase()} ({groupedEvents[selectedEventTab].length})
              </div>
              <div className="h-full max-h-[560px] overflow-y-auto p-2 space-y-2">
                {groupedEvents[selectedEventTab].length === 0 ? (
                  <p className="text-xs text-gray-400">暂无</p>
                ) : (
                  groupedEvents[selectedEventTab].map((event, idx) => {
                    const eventId = `${selectedEventTab}-${event.type || 'event'}-${event.timestamp || ''}-${resolveEventSessionId(event) || ''}-${idx}`;
                    const expanded = !!expandedEventIds[eventId];
                    return (
                      <div key={eventId} className="text-xs bg-gray-50 rounded border border-gray-200">
                        <button
                          onClick={() =>
                            setExpandedEventIds((prev) => ({
                              ...prev,
                              [eventId]: !prev[eventId],
                            }))
                          }
                          className="w-full text-left px-2 py-1.5 hover:bg-gray-100 rounded"
                        >
                          <p className="font-medium text-gray-700">{formatEventTitle(event)}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">{expanded ? '点击折叠' : '点击查看详情'}</p>
                        </button>
                        {expanded ? (
                          <div className="px-2 pb-2">
                            <pre className="whitespace-pre-wrap text-gray-600">{JSON.stringify(event.properties || event, null, 2)}</pre>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      </div>
    </div>
  );
};

export default RdConversation;
