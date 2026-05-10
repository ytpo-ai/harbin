import React from 'react';
import { DiscussionSedimentMode } from '../../services/discussionService';

type SedimentPanelProps = {
  mode: DiscussionSedimentMode;
  latestTitle?: string;
  latestContent?: string;
  latestCreatedAt?: string;
  history?: Array<{
    id: string;
    version: number;
    title: string;
    content: string;
    threadScope: string[];
    createdAt: string;
  }>;
  canDeleteHistory?: boolean;
  deletingHistoryId?: string;
  generating: boolean;
  updatingMode: boolean;
  onChangeMode: (mode: DiscussionSedimentMode) => void;
  onGenerate: () => void;
  onDeleteHistory: (historyId: string) => void;
};

const SedimentPanel: React.FC<SedimentPanelProps> = ({
  mode,
  latestTitle,
  latestContent,
  latestCreatedAt,
  history = [],
  canDeleteHistory = false,
  deletingHistoryId,
  generating,
  updatingMode,
  onChangeMode,
  onGenerate,
  onDeleteHistory,
}) => {
  const [selectedHistoryId, setSelectedHistoryId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!history.length) {
      setSelectedHistoryId(null);
      return;
    }

    if (!history.some((item) => item.id === selectedHistoryId)) {
      setSelectedHistoryId(history[0].id);
    }
  }, [history, selectedHistoryId]);

  const selectedHistory = history.find((item) => item.id === selectedHistoryId);

  return (
    <div className="space-y-4">
      <div className="border border-[#c6c6c6] bg-white p-4">
        <div className="mb-3 text-sm font-medium text-[#161616]">文档沉淀模式</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChangeMode('manual')}
            disabled={updatingMode}
            className={`border px-3 py-2 text-sm ${
              mode === 'manual'
                ? 'border-[#0f62fe] bg-[#edf5ff] text-[#0f62fe]'
                : 'border-[#c6c6c6] text-[#525252] hover:bg-[#f4f4f4]'
            }`}
          >
            手动
          </button>
          <button
            type="button"
            onClick={() => onChangeMode('realtime')}
            disabled={updatingMode}
            className={`border px-3 py-2 text-sm ${
              mode === 'realtime'
                ? 'border-[#0f62fe] bg-[#edf5ff] text-[#0f62fe]'
                : 'border-[#c6c6c6] text-[#525252] hover:bg-[#f4f4f4]'
            }`}
          >
            实时
          </button>
        </div>
      </div>

      <div className="border border-[#c6c6c6] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-[#161616]">最新沉淀文档</div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="bg-[#0f62fe] px-3 py-1 text-xs text-white hover:bg-[#0353e9] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? '沉淀中...' : '立即沉淀'}
          </button>
        </div>
        {latestCreatedAt ? (
          <div className="mb-2 text-xs text-[#6f6f6f]">更新时间：{new Date(latestCreatedAt).toLocaleString()}</div>
        ) : null}
        <div className="mb-2 text-xs text-[#262626]">标题：{latestTitle || '未命名沉淀'}</div>
        <div className="mb-2 text-xs text-[#6f6f6f]">点击“立即沉淀”后，结果会先更新到这里，历史版本可在下方查看。</div>
        <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap bg-[#f4f4f4] p-3 text-xs leading-5 text-[#262626]">
          {latestContent || '暂无沉淀内容'}
        </pre>
      </div>

      <div className="border border-[#c6c6c6] bg-white p-4">
        <div className="mb-3 text-sm font-medium text-[#161616]">沉淀历史版本</div>
        {!history.length ? (
          <div className="text-xs text-[#6f6f6f]">暂无历史沉淀记录</div>
        ) : (
          <>
            <div className="max-h-[140px] space-y-2 overflow-auto pr-1">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedHistoryId(item.id)}
                  className={`w-full border px-2 py-2 text-left text-xs ${
                    selectedHistoryId === item.id
                      ? 'border-[#0f62fe] bg-[#edf5ff] text-[#0f62fe]'
                      : 'border-[#c6c6c6] text-[#525252] hover:bg-[#f4f4f4]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.title || '未命名沉淀'}</div>
                      <div className="mt-1 text-[11px] text-[#6f6f6f]">V{item.version}</div>
                      <div className="mt-1 text-[11px]">{new Date(item.createdAt).toLocaleString()}</div>
                    </div>
                    {canDeleteHistory ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteHistory(item.id);
                        }}
                        disabled={deletingHistoryId === item.id}
                        className="shrink-0 border border-[#c6c6c6] px-2 py-1 text-[11px] text-[#525252] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingHistoryId === item.id ? '删除中' : '删除'}
                      </button>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
            <pre className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap bg-[#f4f4f4] p-3 text-xs leading-5 text-[#262626]">
              {selectedHistory?.content || '请选择一个历史版本查看内容'}
            </pre>
          </>
        )}
      </div>
    </div>
  );
};

export default SedimentPanel;
