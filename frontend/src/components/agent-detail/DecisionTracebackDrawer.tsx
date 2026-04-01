import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { AgentRunListItem, AgentRunScore } from '../../services/agentService';
import { TRACEBACK_TABS, TracebackTab, getScoreBadgeClass } from './constants';
import { RunMessageRecord } from './hooks/useLogState';
import { PromptInspector } from './traceback/PromptInspector';
import { ExecutionTimeline } from './traceback/ExecutionTimeline';
import { DiagnosisPanel } from './traceback/DiagnosisPanel';
import { RoundNavigator } from './traceback/RoundNavigator';

interface DecisionTracebackDrawerProps {
  open: boolean;
  run: AgentRunListItem;
  totalDurationMs: number;
  scoreData: AgentRunScore | null;
  messages: RunMessageRecord[];
  onClose: () => void;
}

export const DecisionTracebackDrawer: React.FC<DecisionTracebackDrawerProps> = ({
  open,
  run,
  totalDurationMs,
  scoreData,
  messages,
  onClose,
}) => {
  const [activeTab, setActiveTab] = React.useState<TracebackTab>('prompt');
  const [activeRound, setActiveRound] = React.useState(1);
  const roundRefs = React.useRef<Record<number, HTMLDivElement | null>>({});

  const timelineMessages = React.useMemo(() => messages.filter((message) => message.role !== 'system'), [messages]);
  const rounds = React.useMemo(() => {
    const maxRound = Math.max(
      1,
      scoreData?.stats.totalRounds || 0,
      ...timelineMessages.map((message) => (typeof message.stepIndex === 'number' ? message.stepIndex + 1 : 1)),
    );
    return Array.from({ length: maxRound }).map((_, index) => {
      const round = index + 1;
      const hasDeduction = (scoreData?.deductions || []).some((item) => item.round === round);
      const hasError = timelineMessages.some((message) => {
        if (typeof message.stepIndex === 'number' && message.stepIndex + 1 !== round) return false;
        return message.parts.some((part) => !!part.error || part.status === 'error');
      });
      return { round, hasDeduction, hasError };
    });
  }, [scoreData, timelineMessages]);

  if (!open) return null;

  const durationText = totalDurationMs >= 1000 ? `${(totalDurationMs / 1000).toFixed(1)}s` : `${totalDurationMs}ms`;
  const scoreValue = Math.round(scoreData?.score || run.score || 0);

  return (
    <div className="fixed inset-0 z-[48]">
      <button className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={onClose} aria-label="关闭决策回溯" />
      <aside className="absolute right-0 top-0 h-full w-full border-l border-slate-200 bg-white shadow-2xl sm:w-[92vw] lg:w-[72vw]">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="min-w-0 flex-1 pr-4">
              <h3 className="truncate text-base font-semibold text-slate-900">决策回溯 · {run.taskTitle || '未命名任务'}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>Agent: {run.agentName || '-'}</span>
                <span className={`inline-flex rounded-full px-2 py-0.5 ring-1 ${getScoreBadgeClass(scoreValue)}`}>{scoreValue}/100分</span>
                <span>耗时: {durationText}</span>
                <span>轮次: {scoreData?.stats.totalRounds || rounds.length}</span>
                <span>总扣分: {scoreData?.totalDeductions || 0}</span>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="关闭抽屉">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="border-b border-slate-200 px-5 py-2.5">
            <div className="flex flex-wrap gap-2">
              {TRACEBACK_TABS.map((tab) => {
                const selected = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                      selected ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <RoundNavigator
              rounds={rounds}
              activeRound={activeRound}
              onSelectRound={(round) => {
                setActiveRound(round);
                if (activeTab !== 'timeline') {
                  setActiveTab('timeline');
                }
                window.requestAnimationFrame(() => {
                  roundRefs.current[round]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }}
            />

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {activeTab === 'prompt' && <PromptInspector messages={messages} />}
              {activeTab === 'timeline' && (
                <ExecutionTimeline
                  messages={messages}
                  deductions={scoreData?.deductions || []}
                  activeRound={activeRound}
                  onActiveRoundChange={setActiveRound}
                  roundRefs={roundRefs}
                />
              )}
              {activeTab === 'diagnosis' && <DiagnosisPanel runId={run.id} scoreData={scoreData || null} />}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
