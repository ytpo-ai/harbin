import React, { useState } from 'react';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useParams } from 'react-router-dom';
import { LogTab, MemoTab, SessionTab, useAgentDetail } from '../components/agent-detail';

const AgentDetail: React.FC = () => {
  const { agentId = '' } = useParams<{ agentId: string }>();
  const [activeTab, setActiveTab] = useState<'memo' | 'log' | 'session'>('memo');
  const [pendingSessionId, setPendingSessionId] = useState('');

  const { data: agent, isLoading: isAgentLoading, goBackToList } = useAgentDetail(agentId);

  const handleViewSessionFromLog = (sessionId: string) => {
    setPendingSessionId(sessionId);
    setActiveTab('session');
  };

  if (!agentId) {
    return (
      <div className="rounded-lg bg-white p-6 shadow">
        <p className="text-sm text-gray-600">未找到 Agent ID，请从 Agent 列表进入。</p>
        <button
          onClick={goBackToList}
          className="mt-3 inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700"
        >
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          返回 Agent 列表
        </button>
      </div>
    );
  }

  if (isAgentLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-white to-blue-50/30 p-6 shadow-sm ring-1 ring-slate-200/50">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <button onClick={goBackToList} className="mb-3 inline-flex items-center text-sm text-slate-500 transition-colors hover:text-slate-700">
              <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
              返回 Agent 列表
            </button>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{agent?.name || 'Agent 详情'}</h1>
            <p className="mt-1.5 text-sm text-slate-500">{agent?.description || '查看 Agent 详细信息与运营数据'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100/80 px-3.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200/60">{agent?.roleId || '-'}</span>
            <span className="rounded-full bg-slate-100/80 px-3.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200/60">{agent?.model?.name || '-'}</span>
            <span
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 ${
                agent?.isActive ? 'bg-emerald-50/80 text-emerald-700 ring-emerald-200/60' : 'bg-slate-100/80 text-slate-500 ring-slate-200/60'
              }`}
            >
              {agent?.isActive ? '活跃' : '非活跃'}
            </span>
          </div>
        </div>
      </div>

      <div className="relative">
        <nav className="flex gap-1 border-b border-slate-200/60">
          {(['memo', 'log', 'session'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-4 py-3 text-sm font-medium transition-all duration-200 ${activeTab === tab ? 'text-primary-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <span className="relative z-10">{tab === 'memo' ? '备忘录' : tab === 'log' ? '日志' : 'Session'}</span>
              {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-gradient-to-r from-primary-500 to-primary-600" />}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'memo' && <MemoTab agentId={agentId} agentName={agent?.name} />}
      {activeTab === 'log' && <LogTab agentId={agentId} onViewSession={handleViewSessionFromLog} />}
      {activeTab === 'session' && (
        <SessionTab
          agentId={agentId}
          externalSessionId={pendingSessionId}
          onExternalSessionHandled={() => setPendingSessionId('')}
        />
      )}
    </div>
  );
};

export default AgentDetail;
