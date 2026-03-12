import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'react-query';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  SparklesIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import { rdManagementService, OpencodeCurrentContext, OpencodeEventPayload, RdProject } from '../services/rdManagementService';
import { agentService } from '../services/agentService';
import { Agent } from '../types';

type ViewTab = 'chat' | 'events';

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
  if (v.includes('prompt') || v.includes('message')) return 'prompt';
  if (v.includes('command')) return 'command';
  if (v.includes('error') || v.includes('fail')) return 'error';
  return 'other';
}

const RdManagement: React.FC = () => {
  const [viewTab, setViewTab] = useState<ViewTab>('chat');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedProjectPath, setSelectedProjectPath] = useState('');
  const [selectedEiProjectId, setSelectedEiProjectId] = useState('');
  const [promptText, setPromptText] = useState('');
  const [events, setEvents] = useState<OpencodeEventPayload[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: currentContext, refetch: refetchContext } = useQuery<OpencodeCurrentContext>(
    'rd-opencode-current',
    () => rdManagementService.getCurrentOpencodeContext(),
    { refetchInterval: 15000, retry: false }
  );

  const { data: sessions = [], refetch: refetchSessions } = useQuery(
    ['rd-opencode-sessions', selectedProjectPath],
    () => rdManagementService.getOpencodeSessions(selectedProjectPath || undefined),
    { enabled: !!selectedProjectPath, refetchInterval: 10000, retry: false }
  );

  const { data: localProjects = [], refetch: refetchLocalProjects } = useQuery<RdProject[]>(
    ['rd-local-projects', selectedAgentId],
    () => rdManagementService.getProjects({ syncedFromAgentId: selectedAgentId || undefined }),
    { retry: false }
  );

  const { data: agents = [] } = useQuery<Agent[]>(
    'rd-agents',
    () => agentService.getAgents(),
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
    () => rdManagementService.getOpencodeSession(selectedSessionId),
    { enabled: !!selectedSessionId, retry: false }
  );

  const { data: sessionMessages = [], refetch: refetchMessages, isLoading: messagesLoading } = useQuery(
    ['rd-opencode-session-messages', selectedSessionId],
    () => rdManagementService.getOpencodeSessionMessages(selectedSessionId),
    { enabled: !!selectedSessionId, refetchInterval: 4000, retry: false }
  );

  const promptMutation = useMutation(
    () => rdManagementService.promptOpencodeSession(selectedSessionId, promptText),
    {
      onSuccess: async () => {
        setPromptText('');
        await refetchMessages();
        await refetchSessions();
      },
    }
  );

  const syncAgentProjectsMutation = useMutation(
    () => rdManagementService.syncAgentOpencodeProjects(selectedAgentId),
    {
      onSuccess: async () => {
        await refetchLocalProjects();
      },
    }
  );

  const rdAgents = useMemo(
    () =>
      agents.filter((agent) => {
        const config = agent.config as Record<string, any> | undefined;
        const provider = String(config?.execution?.provider || '').toLowerCase();
        return agent.isActive && provider === 'opencode';
      }),
    [agents],
  );

  useEffect(() => {
    const source = rdManagementService.subscribeOpencodeEvents((event) => {
      setEvents((prev) => [event, ...prev].slice(0, 200));
    });
    return () => source.close();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionMessages.length]);

  useEffect(() => {
    if (!selectedAgentId && rdAgents.length > 0) {
      setSelectedAgentId(rdAgents[0].id);
    }
  }, [rdAgents, selectedAgentId]);

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
    const groups: Record<string, OpencodeEventPayload[]> = { tool: [], prompt: [], command: [], error: [], other: [] };
    events.forEach((event) => {
      groups[getEventGroup(event.type)].push(event);
    });
    return groups;
  }, [events]);

  const refreshAll = async () => {
    await Promise.all([refetchContext(), refetchSessions(), refetchMessages(), refetchLocalProjects()]);
  };

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col gap-4">
      <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex flex-wrap items-center gap-2">
        <select
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 min-w-[220px]"
        >
          <option value="">先选择研发 Agent</option>
          {rdAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
        <select
          value={selectedEiProjectId}
          onChange={(e) => setSelectedEiProjectId(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 min-w-[260px]"
          disabled={!selectedAgentId}
        >
          <option value="">{selectedAgentId ? '选择 EI Project' : '请先选择 Agent'}</option>
          {localProjects.map((project) => (
            <option key={project._id} value={project._id}>{project.name}</option>
          ))}
        </select>
        <button
          onClick={() => syncAgentProjectsMutation.mutate()}
          disabled={!selectedAgentId || syncAgentProjectsMutation.isLoading}
          className="px-2 py-1 text-xs rounded text-gray-700 hover:bg-gray-100 border border-gray-200 disabled:text-gray-400 disabled:bg-gray-50"
        >
          <span className="inline-flex items-center gap-1"><SparklesIcon className="h-4 w-4" />同步 Agent OpenCode Projects</span>
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

      <section className="lg:col-span-9 bg-white border border-gray-200 rounded-lg flex flex-col min-h-0">
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
              ) : sessionMessages.length === 0 ? (
                <p className="text-sm text-gray-400">该 session 暂无消息</p>
              ) : (
                sessionMessages.map((message: any, idx: number) => {
                  const role = message.role || message.type || 'assistant';
                  const text = extractMessageText(message);
                  const isUser = role === 'user';
                  return (
                    <div key={`${idx}-${role}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${isUser ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                        <pre className="whitespace-pre-wrap text-sm font-sans">{text || JSON.stringify(message, null, 2)}</pre>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-gray-200">
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
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(['tool', 'prompt', 'command', 'error', 'other'] as const).map((group) => (
              <div key={group} className="border border-gray-200 rounded-lg">
                <div className="px-3 py-2 border-b border-gray-200 text-sm font-medium text-gray-900">
                  {group.toUpperCase()} ({groupedEvents[group].length})
                </div>
                <div className="max-h-[480px] overflow-y-auto p-2 space-y-2">
                  {groupedEvents[group].length === 0 ? (
                    <p className="text-xs text-gray-400">暂无</p>
                  ) : (
                    groupedEvents[group].map((event, idx) => (
                      <div key={`${group}-${idx}`} className="text-xs bg-gray-50 rounded px-2 py-1">
                        <p className="font-medium text-gray-700">{event.type || 'event'}</p>
                        <pre className="whitespace-pre-wrap text-gray-600">{JSON.stringify(event.properties || event, null, 2)}</pre>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      </div>
    </div>
  );
};

export default RdManagement;
