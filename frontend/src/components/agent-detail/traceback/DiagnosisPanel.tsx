import React from 'react';
import { AgentRunScore, agentService } from '../../../services/agentService';

interface DiagnosisPanelProps {
  runId: string;
  scoreData: AgentRunScore | null;
}

const buildPresetQuestions = (scoreData: AgentRunScore | null): string[] => {
  const rules = new Set((scoreData?.deductions || []).map((item) => item.ruleId));
  const questions: string[] = [];
  if (rules.has('D3')) questions.push('为什么重复调用了相同工具?');
  if (rules.has('D11')) questions.push('为什么达到了最大轮次上限?');
  if (rules.has('D8') || rules.has('D9')) questions.push('为什么没有调用工具而是输出了纯文本?');
  questions.push('扣分记忆是否被有效利用?');
  questions.push('哪些上下文因素影响了 LLM 决策?');
  return Array.from(new Set(questions)).slice(0, 5);
};

export const DiagnosisPanel: React.FC<DiagnosisPanelProps> = ({ runId, scoreData }) => {
  const [question, setQuestion] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [answer, setAnswer] = React.useState('');
  const [error, setError] = React.useState('');
  const controllerRef = React.useRef<AbortController | null>(null);

  const presets = React.useMemo(() => buildPresetQuestions(scoreData), [scoreData]);

  React.useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const ask = async (value: string) => {
    const nextQuestion = String(value || '').trim();
    if (!nextQuestion || loading) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');
    setAnswer('');
    try {
      await agentService.diagnoseRun(runId, nextQuestion, {
        signal: controller.signal,
        onChunk: (chunk) => {
          setAnswer((prev) => prev + chunk);
        },
      });
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      setError(err instanceof Error ? err.message : '诊断请求失败');
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">快速诊断</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((item) => (
            <button
              key={item}
              onClick={() => {
                setQuestion(item);
                void ask(item);
              }}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">自由提问</p>
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="输入你想问的问题..."
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
          <button
            onClick={() => void ask(question)}
            disabled={loading || !question.trim()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '分析中...' : '发送'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-slate-500">分析结果</p>
        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : answer ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{answer}</div>
        ) : (
          <p className="text-sm text-slate-400">发起一次诊断后，将在这里显示分析结果。</p>
        )}
      </div>
    </div>
  );
};
