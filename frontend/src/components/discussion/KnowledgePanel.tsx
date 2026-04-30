import React from 'react';
import { DiscussionKnowledgeEntry } from '../../services/discussionService';

type KnowledgePanelProps = {
  keyword: string;
  loading: boolean;
  items: DiscussionKnowledgeEntry[];
  onKeywordChange: (keyword: string) => void;
  creatingRequirementForKnowledgeId?: string;
  onToRequirement?: (entry: DiscussionKnowledgeEntry) => void;
};

const credibilityLabelMap: Record<DiscussionKnowledgeEntry['credibility'], string> = {
  high: '高可信',
  medium: '中可信',
  low: '低可信',
  unverified: '待验证',
};

const entryTypeLabelMap: Record<string, string> = {
  fact: '事实',
  data_point: '数据点',
  opinion: '观点',
  source_reference: '来源引用',
  analysis: '分析',
  action_item: '行动项',
};

const KnowledgePanel: React.FC<KnowledgePanelProps> = ({
  keyword,
  loading,
  items,
  onKeywordChange,
  creatingRequirementForKnowledgeId,
  onToRequirement,
}) => {
  return (
    <div className="space-y-4">
      <div className="border border-[#c6c6c6] bg-white p-4">
        <div className="mb-2 text-sm font-medium text-[#161616]">知识检索</div>
        <input
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder="按关键词过滤"
          className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
        />
      </div>

      <div className="border border-[#c6c6c6] bg-white p-4">
        <div className="mb-3 text-sm font-medium text-[#161616]">知识条目 ({items.length})</div>
        {loading ? <div className="text-sm text-[#6f6f6f]">加载中...</div> : null}
        {!loading && items.length === 0 ? <div className="text-sm text-[#6f6f6f]">暂无知识条目</div> : null}
        <div className="max-h-[420px] space-y-3 overflow-auto pr-1">
          {items.map((item) => (
            <div key={item.id} className="border border-[#e0e0e0] bg-[#f4f4f4] p-3">
              <div className="text-sm font-medium text-[#161616]">{item.title}</div>
              <div className="mt-1 text-xs text-[#6f6f6f]">
                {credibilityLabelMap[item.credibility]} · {entryTypeLabelMap[item.entryType || 'fact'] || '事实'} · {item.sourceType}
              </div>
              <div className="mt-2 text-xs leading-5 text-[#262626]">{item.summary || item.content}</div>
              {item.entryType === 'action_item' && item.metadata?.isStructuredData ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => onToRequirement?.(item)}
                    disabled={!onToRequirement || creatingRequirementForKnowledgeId === item.id}
                    className="text-xs text-[#0f62fe] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {creatingRequirementForKnowledgeId === item.id ? '转需求中...' : '转为数据采集需求'}
                  </button>
                </div>
              ) : null}
              {item.keywordTags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.keywordTags.slice(0, 5).map((tag) => (
                    <span key={tag} className="bg-white px-2 py-1 text-[11px] text-[#525252]">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KnowledgePanel;
