import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  FolderIcon,
  PlusIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import { rdManagementService, OpencodeCurrentContext, OpencodeEventPayload, RdProject } from '../services/rdManagementService';

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
  const queryClient = useQueryClient();
  const [viewTab, setViewTab] = useState<ViewTab>('chat');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedProjectPath, setSelectedProjectPath] = useState('');
  const [promptText, setPromptText] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createProjectPath, setCreateProjectPath] = useState('');
  const [events, setEvents] = useState<OpencodeEventPayload[]>([]);
  const [bindProjectId, setBindProjectId] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importNames, setImportNames] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: currentContext, refetch: refetchContext } = useQuery<OpencodeCurrentContext>(
    'rd-opencode-current',
    () => rdManagementService.getCurrentOpencodeContext(),
    { refetchInterval: 15000, retry: false }
  );

  const { data: sessions = [], refetch: refetchSessions } = useQuery(
    'rd-opencode-sessions',
    () => rdManagementService.getOpencodeSessions(),
    { refetchInterval: 10000, retry: false }
  );

  const { data: projects = [], refetch: refetchOpencodeProjects, isFetching: opencodeProjectsLoading } = useQuery(
    'rd-opencode-projects',
    () => rdManagementService.getOpencodeProjects(),
    { enabled: false, retry: false }
  );

  const { data: localProjects = [] } = useQuery<RdProject[]>(
    'rd-local-projects',
    () => rdManagementService.getProjects(),
    { retry: false }
  );

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
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

  const createSessionMutation = useMutation(
    () => rdManagementService.createOpencodeSession({
      projectPath: createProjectPath,
      title: createTitle || undefined,
    }),
    {
      onSuccess: (created) => {
        setCreateTitle('');
        setCreateProjectPath('');
        refetchSessions();
        if (created?.id) setSelectedSessionId(created.id);
      },
    }
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

  const bindMutation = useMutation(
    () => rdManagementService.syncCurrentOpencodeToProject(bindProjectId, {
      sessionId: selectedSessionId || undefined,
      projectPath: selectedProjectPath || undefined,
    }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('rd-local-projects');
      },
    }
  );

  const importProjectMutation = useMutation(
    ({ projectId, projectPath, name }: { projectId?: string; projectPath?: string; name?: string }) =>
      rdManagementService.importOpencodeProject({ projectId, projectPath, name }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('rd-local-projects');
      },
    }
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

  const groupedEvents = useMemo(() => {
    const groups: Record<string, OpencodeEventPayload[]> = { tool: [], prompt: [], command: [], error: [], other: [] };
    events.forEach((event) => {
      groups[getEventGroup(event.type)].push(event);
    });
    return groups;
  }, [events]);

  const refreshAll = async () => {
    await Promise.all([refetchContext(), refetchSessions(), refetchOpencodeProjects(), refetchMessages()]);
  };

  const openImportProjectsModal = async () => {
    const result = await refetchOpencodeProjects();
    const list = result.data || [];
    const names: Record<string, string> = {};
    list.forEach((project: any, index: number) => {
      const path = project.worktree || project.path || project.cwd || '';
      const key = project.id || path || String(index);
      const fallback = (path.split('/').filter(Boolean).pop() || project.id || 'opencode-project').trim();
      names[key] = fallback;
    });
    setImportNames(names);
    setShowImportModal(true);
  };

  return (
    <div className="h-[calc(100vh-7rem)] grid grid-cols-1 lg:grid-cols-12 gap-4">
      <aside className="lg:col-span-3 bg-white border border-gray-200 rounded-lg flex flex-col min-h-0">
        <div className="p-3 border-b border-gray-200 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">OpenCode Sessions</p>
          <button onClick={refreshAll} className="text-gray-500 hover:text-gray-700">
            <ArrowPathIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="p-3 border-b border-gray-200 space-y-2">
          <input
            value={createProjectPath}
            onChange={(e) => setCreateProjectPath(e.target.value)}
            placeholder="project path, e.g. /Users/..."
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
          />
          <input
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder="session title (optional)"
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
          />
          <button
            onClick={() => createSessionMutation.mutate()}
            disabled={!createProjectPath || createSessionMutation.isLoading}
            className="w-full text-sm bg-primary-600 text-white rounded px-2 py-1.5 disabled:bg-gray-300"
          >
            <span className="inline-flex items-center justify-center gap-1">
              <PlusIcon className="h-4 w-4" /> 新建 Session
            </span>
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

      <section className="lg:col-span-9 bg-white border border-gray-200 rounded-lg flex flex-col min-h-0">
        <div className="p-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">{sessionDetail?.title || selectedSessionId || '未选择 Session'}</p>
            <p className="text-xs text-gray-500">Project: {selectedProjectPath || currentContext?.path?.cwd || currentContext?.project?.path || '-'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openImportProjectsModal}
              className="px-2 py-1 text-xs rounded text-gray-700 hover:bg-gray-100 border border-gray-200"
            >
              查询 OpenCode 项目
            </button>
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
            <div className="p-3 border-b border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-2">
              <select
                value={selectedProjectPath}
                onChange={(e) => setSelectedProjectPath(e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="">选择 OpenCode 项目路径</option>
                {projects.map((project: any, idx: number) => {
                  const p = project.path || project.root || project.cwd || project.name || '';
                  return <option key={`${p}-${idx}`} value={p}>{p}</option>;
                })}
              </select>

              <select
                value={bindProjectId}
                onChange={(e) => setBindProjectId(e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="">绑定到本地研发项目(可选)</option>
                {localProjects.map((project) => (
                  <option key={project._id} value={project._id}>{project.name}</option>
                ))}
              </select>

              <button
                onClick={() => bindMutation.mutate()}
                disabled={!bindProjectId || !selectedSessionId || bindMutation.isLoading}
                className="text-sm rounded bg-gray-900 text-white px-2 py-1.5 disabled:bg-gray-300"
              >
                <span className="inline-flex items-center gap-1"><FolderIcon className="h-4 w-4" />同步到本地项目</span>
              </button>
            </div>

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

      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-4xl max-h-[85vh] overflow-hidden border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">OpenCode 项目列表</p>
              <button onClick={() => setShowImportModal(false)} className="text-sm text-gray-500 hover:text-gray-700">关闭</button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[72vh]">
              {opencodeProjectsLoading ? (
                <p className="text-sm text-gray-500">查询中...</p>
              ) : projects.length === 0 ? (
                <p className="text-sm text-gray-400">未查询到 OpenCode 项目</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {projects.map((project: any, index: number) => {
                    const projectPath = project.worktree || project.path || project.cwd || '';
                    const key = project.id || projectPath || String(index);
                    const importName = importNames[key] ?? '';
                    return (
                      <div key={key} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <p className="text-sm font-medium text-gray-900 truncate">{project.id || 'unknown project'}</p>
                        <p className="text-xs text-gray-600 mt-1 break-all">{projectPath || '-'}</p>
                        <p className="text-xs text-gray-500 mt-1">VCS: {project.vcs || '-'}</p>

                        <div className="mt-3 space-y-2">
                          <label className="text-xs text-gray-700">导入后项目名</label>
                          <input
                            value={importName}
                            onChange={(e) => setImportNames((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                          />
                          <button
                            onClick={() =>
                              importProjectMutation.mutate({
                                projectId: project.id,
                                projectPath,
                                name: importName,
                              })
                            }
                            disabled={importProjectMutation.isLoading}
                            className="w-full text-sm rounded bg-primary-600 text-white px-3 py-1.5 disabled:bg-gray-300"
                          >
                            导入（项目 + sessions + events）
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RdManagement;
