import React from 'react';
import { AgentRunScoreDeduction } from '../../../services/agentService';
import { RunMessageRecord } from '../hooks/useLogState';

interface ExecutionTimelineProps {
  messages: RunMessageRecord[];
  deductions: AgentRunScoreDeduction[];
  activeRound: number;
  onActiveRoundChange: (round: number) => void;
  roundRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
}

export interface TimelineRound {
  round: number;
  /** 原始 stepIndex（0-indexed），用于匹配评分扣分数据中的 round 字段 */
  stepIndex?: number;
  messages: RunMessageRecord[];
}

const toJsonPreview = (value: unknown): string => {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return '-';
    return raw.length > 80 ? `${raw.slice(0, 80)}...` : raw;
  } catch {
    return '-';
  }
};

export const buildTimelineRounds = (messages: RunMessageRecord[]): TimelineRound[] => {
  const nonSystem = messages.filter((message) => message.role !== 'system');
  const hasStepIndex = nonSystem.some((message) => typeof message.stepIndex === 'number');
  const rounds: TimelineRound[] = [];

  if (hasStepIndex) {
    const map = new Map<number, RunMessageRecord[]>();
    for (const message of nonSystem) {
      const key = typeof message.stepIndex === 'number' ? message.stepIndex : 0;
      const list = map.get(key) || [];
      list.push(message);
      map.set(key, list);
    }
    Array.from(map.keys())
      .sort((a, b) => a - b)
      .forEach((key, index) => {
        rounds.push({ round: index + 1, stepIndex: key, messages: map.get(key) || [] });
      });
    return rounds;
  }

  let current: RunMessageRecord[] = [];
  for (const message of nonSystem) {
    const currentHasAssistant = current.some((item) => item.role === 'assistant');
    if (message.role === 'assistant' && currentHasAssistant) {
      rounds.push({ round: rounds.length + 1, messages: current });
      current = [message];
    } else {
      current.push(message);
    }
  }
  if (current.length > 0) {
    rounds.push({ round: rounds.length + 1, messages: current });
  }
  return rounds;
};

export const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({ messages, deductions, activeRound, onActiveRoundChange, roundRefs }) => {
  const [expandedJson, setExpandedJson] = React.useState<Record<string, boolean>>({});
  const rounds = React.useMemo(() => buildTimelineRounds(messages), [messages]);

  return (
    <div className="space-y-3">
      {rounds.map((roundItem) => {
        const roundDeductions = deductions.filter((item) =>
          typeof roundItem.stepIndex === 'number'
            ? item.round === roundItem.stepIndex
            : item.round === roundItem.round,
        );
        const hasError = roundItem.messages.some((message) => message.parts.some((part) => !!part.error || part.status === 'error'));

        return (
          <div
            key={roundItem.round}
            ref={(node) => {
              roundRefs.current[roundItem.round] = node;
            }}
            onMouseEnter={() => onActiveRoundChange(roundItem.round)}
            className={`rounded-lg border bg-white ${activeRound === roundItem.round ? 'border-primary-300 shadow-sm' : 'border-slate-200'}`}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-800">Round {roundItem.round}</p>
              <div className="flex items-center gap-2 text-xs">
                {hasError && <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700">工具错误</span>}
                {roundDeductions.length > 0 && <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">⚠ {roundDeductions.length} 条扣分</span>}
              </div>
            </div>

            <div className="space-y-3 px-4 py-3">
              {roundItem.messages.map((message) => (
                <div key={message.id} className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">{message.role}</span>
                    <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                    {typeof message.tokens?.input === 'number' || typeof message.tokens?.output === 'number' ? (
                      <span>
                        tokens: in={message.tokens?.input || 0} out={message.tokens?.output || 0}
                      </span>
                    ) : null}
                  </div>

                  {message.content ? <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">{message.content}</p> : null}

                  {message.parts.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {message.parts.map((part) => {
                        const key = `${message.id}-${part.id}`;
                        const open = expandedJson[key] === true;
                        const hasJson = part.input !== undefined || part.output !== undefined;
                        return (
                          <div key={part.id} className="rounded border border-slate-200 bg-white px-2.5 py-2 text-[11px]">
                            <div className="flex flex-wrap items-center gap-1.5 text-slate-600">
                              <span className="font-semibold">{part.type}</span>
                              {part.toolId && <span>· {part.toolId}</span>}
                              {part.error && <span className="text-rose-600">· {part.error}</span>}
                              {hasJson && (
                                <button
                                  className="ml-auto text-primary-600 hover:text-primary-700"
                                  onClick={() => setExpandedJson((prev) => ({ ...prev, [key]: !prev[key] }))}
                                >
                                  {open ? '收起 JSON' : '展开 JSON'}
                                </button>
                              )}
                            </div>
                            {hasJson && (
                              <div className="mt-1">
                                {open ? (
                                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[11px] text-slate-100">
                                    {JSON.stringify({ input: part.input, output: part.output }, null, 2)}
                                  </pre>
                                ) : (
                                  <p className="text-slate-500">{toJsonPreview({ input: part.input, output: part.output })}</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}

              {roundDeductions.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {roundDeductions.map((item, index) => (
                    <p key={`${item.ruleId}-${index}`}>
                      [{item.ruleId}] -{item.points}分 {item.detail || ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
