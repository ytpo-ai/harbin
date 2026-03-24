import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
  AgentSession,
  DebugRuntimeTaskTypeOverride,
  OrchestrationTask,
} from '../../services/orchestrationService';
import { DrawerTab } from './constants';
import DebugDrawerDebugTab from './DebugDrawerDebugTab';
import DebugDrawerSessionTab from './DebugDrawerSessionTab';

interface DebugDrawerProps {
  open: boolean;
  task: OrchestrationTask | null;
  activeDrawerTab: DrawerTab;
  debugAgentId: string;
  debugTitle: string;
  debugDescription: string;
  debugRuntimeTaskType: 'auto' | DebugRuntimeTaskTypeOverride;
  debugHint: string;
  debugSessionId: string;
  debugSessionDetail: AgentSession | undefined;
  debugSessionLoading: boolean;
  agents: Array<{ id: string; name: string }>;
  debugSaving: boolean;
  debugRunning: boolean;
  reassignRunning: boolean;
  editable: boolean;
  onClose: () => void;
  onTabChange: (tab: DrawerTab) => void;
  onChangeAgentId: (value: string) => void;
  onChangeTitle: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onChangeRuntimeType: (value: 'auto' | DebugRuntimeTaskTypeOverride) => void;
  onSaveDraft: () => void;
  onRunDebug: () => void;
}

const DebugDrawer: React.FC<DebugDrawerProps> = ({
  open,
  task,
  activeDrawerTab,
  debugAgentId,
  debugTitle,
  debugDescription,
  debugRuntimeTaskType,
  debugHint,
  debugSessionId,
  debugSessionDetail,
  debugSessionLoading,
  agents,
  debugSaving,
  debugRunning,
  reassignRunning,
  editable,
  onClose,
  onTabChange,
  onChangeAgentId,
  onChangeTitle,
  onChangeDescription,
  onChangeRuntimeType,
  onSaveDraft,
  onRunDebug,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full bg-white shadow-2xl sm:w-[92vw] lg:w-[56vw] border-l border-slate-200 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">单步调试</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {task ? `Step #${task.order + 1} · ${task.status}` : '请选择任务后再调试'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-slate-200 inline-flex gap-2">
          <button
            onClick={() => onTabChange('debug')}
            className={`px-3 py-1.5 text-xs rounded ${activeDrawerTab === 'debug' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            调试
          </button>
          <button
            onClick={() => onTabChange('session')}
            className={`px-3 py-1.5 text-xs rounded ${activeDrawerTab === 'session' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Session
          </button>
        </div>

        {!task ? (
          <div className="flex-1 p-4 text-sm text-slate-500">当前计划中未找到该任务，请重新选择。</div>
        ) : activeDrawerTab === 'debug' ? (
          <DebugDrawerDebugTab
            task={task}
            editable={editable}
            debugAgentId={debugAgentId}
            debugTitle={debugTitle}
            debugDescription={debugDescription}
            debugRuntimeTaskType={debugRuntimeTaskType}
            debugHint={debugHint}
            agents={agents}
            debugSaving={debugSaving}
            debugRunning={debugRunning}
            reassignRunning={reassignRunning}
            onChangeAgentId={onChangeAgentId}
            onChangeTitle={onChangeTitle}
            onChangeDescription={onChangeDescription}
            onChangeRuntimeType={onChangeRuntimeType}
            onSaveDraft={onSaveDraft}
            onRunDebug={onRunDebug}
          />
        ) : (
          <DebugDrawerSessionTab
            debugSessionId={debugSessionId}
            debugSessionDetail={debugSessionDetail}
            debugSessionLoading={debugSessionLoading}
          />
        )}
      </aside>
    </div>
  );
};

export default DebugDrawer;
