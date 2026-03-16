import React, { useEffect, useMemo, useState } from 'react';
import { agentService } from '../services/agentService';
import { useAgentTaskSse } from '../hooks/use-agent-task-sse';
import { Agent } from '../types';
import { useQuery } from 'react-query';

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

const formatHeartbeatTime = (timestamp: string | null, nowMs: number): string => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const timeLabel = Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
  if (timeLabel === '-') return '-';

  const diffSeconds = Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
  const relative = diffSeconds < 60
    ? `${diffSeconds}秒前`
    : `${Math.floor(diffSeconds / 60)}分钟前`;

  return `${timeLabel} - ${relative}`;
};

const AgentTaskRunner: React.FC = () => {
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [taskText, setTaskText] = useState('');
  const [taskId, setTaskId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const { data: agents = [] } = useQuery<Agent[]>('agent-task-runner-agents', () => agentService.getAgents(), {
    retry: false,
  });

  const opencodeAgents = useMemo(() => {
    return agents.filter((agent) => {
      const provider = String((agent.config as any)?.execution?.provider || '').toLowerCase();
      return agent.isActive && provider === 'opencode';
    });
  }, [agents]);

  const selectedAgent = useMemo(
    () => opencodeAgents.find((agent) => agent.id === selectedAgentId),
    [opencodeAgents, selectedAgentId],
  );

  const stream = useAgentTaskSse(taskId, Boolean(taskId));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!stream.lastHeartbeatAt) return () => undefined;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [stream.lastHeartbeatAt]);

  const handleCreateTask = async () => {
    if (!selectedAgentId || !taskText.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const idempotencyKey = `agent-task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const created = await agentService.createAgentTask({
        agentId: selectedAgentId,
        task: taskText.trim(),
        idempotencyKey,
      });
      setTaskId(created.taskId);
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        '创建任务失败';
      setCreateError(String(message));
    } finally {
      setCreating(false);
    }
  };

  const handleCancelTask = async () => {
    if (!taskId) return;
    await agentService.cancelAgentTask(taskId, 'cancelled from UI');
    await stream.refreshTaskInfo();
  };

  return (
    <div className="h-[calc(100vh-7rem)] grid grid-cols-1 lg:grid-cols-12 gap-4">
      <section className="lg:col-span-4 bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <h1 className="text-base font-semibold text-gray-900">Agent Task SSE Runner</h1>
        <p className="text-xs text-gray-500">创建异步任务并通过 SSE 观察执行事件（支持断线续连）。</p>

        <label className="block">
          <span className="text-xs text-gray-600">OpenCode Agent</span>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded px-2 py-2 text-sm"
          >
            <option value="">请选择 Agent</option>
            {opencodeAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>

        <div className="text-xs text-gray-500">
          当前模型：{selectedAgent?.model?.name || selectedAgent?.model?.id || '-'}
        </div>

        <label className="block">
          <span className="text-xs text-gray-600">任务输入</span>
          <textarea
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            placeholder="输入你希望 Agent 执行的任务"
            className="mt-1 w-full min-h-[140px] border border-gray-300 rounded px-2 py-2 text-sm"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateTask}
            disabled={!selectedAgentId || !taskText.trim() || creating}
            className="px-3 py-2 text-sm rounded bg-primary-600 text-white disabled:bg-gray-300"
          >
            {creating ? '创建中...' : '创建任务'}
          </button>
          <button
            onClick={handleCancelTask}
            disabled={!taskId || stream.taskInfo?.status === 'succeeded' || stream.taskInfo?.status === 'failed' || stream.taskInfo?.status === 'cancelled'}
            className="px-3 py-2 text-sm rounded border border-gray-300 text-gray-700 disabled:text-gray-400"
          >
            取消任务
          </button>
        </div>

        {taskId ? (
          <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2 text-xs text-gray-600 break-all">
            Task ID: {taskId}
          </div>
        ) : null}

        {createError ? <div className="text-xs text-rose-600">{createError}</div> : null}
      </section>

      <section className="lg:col-span-8 bg-white border border-gray-200 rounded-lg flex flex-col min-h-0">
        <div className="p-4 border-b border-gray-200 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-gray-500">连接状态:</span>
          <span className="font-medium text-gray-800">{stream.connectionState}</span>
          <span className="text-gray-500">重连次数:</span>
          <span className="font-medium text-gray-800">{stream.retryCount}</span>
          <span className="text-gray-500">任务状态:</span>
          <span className="font-medium text-gray-800">{STATUS_LABEL[stream.taskInfo?.status || ''] || '-'}</span>
          <span className="text-gray-500">Serve:</span>
          <span className="font-medium text-gray-800">{stream.taskInfo?.serveId || '-'}</span>
          <span className="text-gray-500">尝试:</span>
          <span className="font-medium text-gray-800">
            {stream.taskInfo?.attempt || 0}/{stream.taskInfo?.maxAttempts || '-'}
          </span>
          <span className="text-gray-500">下次重试:</span>
          <span className="font-medium text-gray-800">
            {stream.taskInfo?.nextRetryAt ? new Date(stream.taskInfo.nextRetryAt).toLocaleString() : '-'}
          </span>
          <span className="text-gray-500">心跳:</span>
          <span className="font-medium text-gray-800">{stream.heartbeatCount}</span>
          <span className="text-gray-500">最后心跳:</span>
          <span className="font-medium text-gray-800">{formatHeartbeatTime(stream.lastHeartbeatAt, nowMs)}</span>
          {stream.errorMessage ? <span className="text-rose-600">{stream.errorMessage}</span> : null}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-0 flex-1 min-h-0">
          <div className="border-r border-gray-200 p-4 overflow-y-auto min-h-0">
            <h2 className="text-sm font-medium text-gray-900 mb-2">Token 输出</h2>
            <pre className="whitespace-pre-wrap text-sm text-gray-700">{stream.tokenText || '暂无输出'}</pre>
          </div>
          <div className="p-4 overflow-y-auto min-h-0">
            <h2 className="text-sm font-medium text-gray-900 mb-2">事件流</h2>
            <div className="space-y-2">
              {stream.events.length === 0 ? (
                <p className="text-xs text-gray-500">暂无事件</p>
              ) : (
                stream.events.map((event) => (
                  <div key={event.id} className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
                    <div className="text-[11px] text-gray-700 flex items-center justify-between">
                      <span>{event.type}</span>
                      <span>#{event.sequence}</span>
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap text-[11px] text-gray-600">{JSON.stringify(event.payload, null, 2)}</pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AgentTaskRunner;
