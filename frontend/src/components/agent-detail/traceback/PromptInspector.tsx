import React from 'react';
import { CONTEXT_LAYER_PATTERNS } from '../constants';
import { RunMessageRecord } from '../hooks/useLogState';

interface PromptInspectorProps {
  messages: RunMessageRecord[];
}

const detectLayer = (content: string, index: number): string => {
  for (const item of CONTEXT_LAYER_PATTERNS) {
    if (item.patterns.some((pattern) => content.includes(pattern))) {
      return item.layer;
    }
  }
  return `System #${index + 1}`;
};

export const PromptInspector: React.FC<PromptInspectorProps> = ({ messages }) => {
  const systemMessages = React.useMemo(() => messages.filter((message) => message.role === 'system'), [messages]);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const next: Record<string, boolean> = {};
    systemMessages.forEach((msg) => {
      const content = String(msg.content || '');
      if (content.includes('执行质量提醒')) {
        next[msg.id] = true;
      }
    });
    setExpanded(next);
  }, [systemMessages]);

  const hasDeductionContext = systemMessages.some((msg) => String(msg.content || '').includes('执行质量提醒'));

  if (!systemMessages.length) {
    return <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">暂无 system messages</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-slate-500">System Messages（共 {systemMessages.length} 条）</p>
      {systemMessages.map((message, index) => {
        const content = String(message.content || '');
        const layer = detectLayer(content, index);
        const isDeduction = layer === '扣分记忆';
        const isOpen = expanded[message.id] === true;
        const preview = content.split('\n').slice(0, 2).join('\n');

        return (
          <div
            key={message.id}
            className={`overflow-hidden rounded-lg border bg-white ${isDeduction ? 'border-amber-200 border-l-4 border-l-amber-400' : 'border-slate-200'}`}
          >
            <button
              className="flex w-full items-center justify-between px-4 py-3 text-left"
              onClick={() => setExpanded((prev) => ({ ...prev, [message.id]: !prev[message.id] }))}
            >
              <span className="text-xs font-semibold text-slate-700">#{index + 1} {layer}</span>
              <span className="text-[11px] font-medium text-primary-600">{isOpen ? '收起' : '展开全文'}</span>
            </button>
            <div className="border-t border-slate-100 px-4 py-3">
              {isOpen ? (
                <pre className={`whitespace-pre-wrap rounded-lg p-3 text-xs leading-relaxed ${isDeduction ? 'bg-slate-900 font-mono text-slate-100' : 'bg-slate-50 text-slate-700'}`}>
                  {content || '-'}
                </pre>
              ) : (
                <p className="line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{preview || '-'}</p>
              )}
            </div>
          </div>
        );
      })}

      {!hasDeductionContext && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          ⚠ 本次执行未检测到扣分记忆注入（未命中关键字：执行质量提醒）
        </div>
      )}
    </div>
  );
};
