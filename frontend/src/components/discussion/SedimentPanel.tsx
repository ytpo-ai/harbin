import React from 'react';
import { DiscussionSedimentMode } from '../../services/discussionService';

type SedimentPanelProps = {
  mode: DiscussionSedimentMode;
  latestContent?: string;
  latestCreatedAt?: string;
  generating: boolean;
  updatingMode: boolean;
  onChangeMode: (mode: DiscussionSedimentMode) => void;
  onGenerate: () => void;
};

const SedimentPanel: React.FC<SedimentPanelProps> = ({
  mode,
  latestContent,
  latestCreatedAt,
  generating,
  updatingMode,
  onChangeMode,
  onGenerate,
}) => {
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
        <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap bg-[#f4f4f4] p-3 text-xs leading-5 text-[#262626]">
          {latestContent || '暂无沉淀内容'}
        </pre>
      </div>
    </div>
  );
};

export default SedimentPanel;
