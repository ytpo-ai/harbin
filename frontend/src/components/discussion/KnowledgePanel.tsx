import React from 'react';
import { DiscussionKnowledgeEntry } from '../../services/discussionService';

type KnowledgePanelProps = {
  keyword: string;
  selectedOutlineSectionId?: string;
  loading: boolean;
  items: DiscussionKnowledgeEntry[];
  outlineSections?: Array<{
    id: string;
    title: string;
    depth: number;
  }>;
  onKeywordChange: (keyword: string) => void;
  onOutlineSectionChange?: (sectionId: string) => void;
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
  selectedOutlineSectionId,
  loading,
  items,
  outlineSections,
  onKeywordChange,
  onOutlineSectionChange,
  creatingRequirementForKnowledgeId,
  onToRequirement,
}) => {
  const [selectedEntry, setSelectedEntry] = React.useState<DiscussionKnowledgeEntry | null>(null);
  const sectionLabelMap = new Map((outlineSections || []).map((section) => [section.id, section.title]));

  const renderStructuredData = (entry: DiscussionKnowledgeEntry) => {
    if (!entry.structuredData) {
      return null;
    }

    const { value, unit, measureDate, compareTo } = entry.structuredData;

    return (
      <div className="mt-2 space-y-1 text-[11px] text-[#525252]">
        {value !== undefined ? <div>数值：{`${value}${unit ? ` ${unit}` : ''}`}</div> : null}
        {measureDate ? <div>时间：{measureDate}</div> : null}
        {compareTo ? (
          <div>
            对比：{`${compareTo.value} (${compareTo.period}${
              compareTo.changePercent !== undefined ? `，变化 ${compareTo.changePercent}%` : ''
            })`}
          </div>
        ) : null}
      </div>
    );
  };

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

        <div className="mt-3">
          <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">章节筛选</label>
          <select
            value={selectedOutlineSectionId || ''}
            onChange={(event) => onOutlineSectionChange?.(event.target.value)}
            className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
          >
            <option value="">全部章节</option>
            {(outlineSections || []).map((section) => (
              <option key={section.id} value={section.id}>
                {`${'  '.repeat(Math.max(0, section.depth))}${section.title}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border border-[#c6c6c6] bg-white p-4">
        <div className="mb-3 text-sm font-medium text-[#161616]">知识条目 ({items.length})</div>
        {loading ? <div className="text-sm text-[#6f6f6f]">加载中...</div> : null}
        {!loading && items.length === 0 ? <div className="text-sm text-[#6f6f6f]">暂无知识条目</div> : null}
        <div className="max-h-[420px] space-y-3 overflow-auto pr-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedEntry(item)}
              className="w-full border border-[#e0e0e0] bg-[#f4f4f4] p-3 text-left transition-colors hover:bg-[#edf5ff]"
            >
              <div className="text-sm font-medium text-[#161616]">{item.title}</div>
              <div className="mt-1 text-xs text-[#6f6f6f]">
                {credibilityLabelMap[item.credibility]} · {entryTypeLabelMap[item.entryType || 'fact'] || '事实'} · {item.sourceType}
              </div>
              <div className="mt-2 text-xs leading-5 text-[#262626]">{item.summary || item.content}</div>
              {item.outlineSectionId ? (
                <div className="mt-1 text-[11px] text-[#525252]">
                  章节：{sectionLabelMap.get(item.outlineSectionId) || item.outlineSectionId}
                </div>
              ) : null}
              {item.entryType === 'action_item' ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToRequirement?.(item);
                    }}
                    disabled={!onToRequirement || creatingRequirementForKnowledgeId === item.id}
                    className="text-xs text-[#0f62fe] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {creatingRequirementForKnowledgeId === item.id
                      ? '转需求中...'
                      : item.metadata?.isStructuredData
                        ? '转为数据采集需求'
                        : '转为需求'}
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
            </button>
          ))}
        </div>
      </div>

      {selectedEntry ? (
        <div className="fixed inset-0 z-40 flex">
          <button
            type="button"
            aria-label="关闭知识条目详情"
            onClick={() => setSelectedEntry(null)}
            className="flex-1 bg-black/30"
          />
          <div className="h-full w-full max-w-xl overflow-y-auto border-l border-[#c6c6c6] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs tracking-wide text-[#6f6f6f]">知识条目详情</div>
                <h3 className="mt-1 text-base font-semibold text-[#161616]">{selectedEntry.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                className="border border-[#c6c6c6] px-2 py-1 text-xs text-[#262626] hover:bg-[#f4f4f4]"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-[#525252]">
              <div>可信度：{credibilityLabelMap[selectedEntry.credibility]}</div>
              <div>类型：{entryTypeLabelMap[selectedEntry.entryType || 'fact'] || '事实'}</div>
              <div>来源：{selectedEntry.sourceType}{selectedEntry.sourceName ? ` · ${selectedEntry.sourceName}` : ''}</div>
              {selectedEntry.outlineSectionId ? (
                <div>章节：{sectionLabelMap.get(selectedEntry.outlineSectionId) || selectedEntry.outlineSectionId}</div>
              ) : null}
              {selectedEntry.sourceUrl ? (
                <a
                  href={selectedEntry.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[#0f62fe] hover:underline"
                >
                  查看来源链接
                </a>
              ) : null}
            </div>

            {selectedEntry.summary ? (
              <div className="mt-5">
                <div className="mb-1 text-xs tracking-wide text-[#6f6f6f]">摘要</div>
                <div className="whitespace-pre-wrap border border-[#e0e0e0] bg-[#f4f4f4] p-3 text-sm leading-6 text-[#262626]">
                  {selectedEntry.summary}
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              <div className="mb-1 text-xs tracking-wide text-[#6f6f6f]">内容</div>
              <div className="whitespace-pre-wrap border border-[#e0e0e0] bg-[#f4f4f4] p-3 text-sm leading-6 text-[#262626]">
                {selectedEntry.content || '暂无内容'}
              </div>
            </div>

            {renderStructuredData(selectedEntry) ? (
              <div className="mt-4 border border-[#e0e0e0] bg-[#f4f4f4] p-3">
                <div className="mb-1 text-xs tracking-wide text-[#6f6f6f]">结构化数据</div>
                {renderStructuredData(selectedEntry)}
              </div>
            ) : null}

            {selectedEntry.keywordTags.length > 0 ? (
              <div className="mt-4">
                <div className="mb-2 text-xs tracking-wide text-[#6f6f6f]">关键词</div>
                <div className="flex flex-wrap gap-1">
                  {selectedEntry.keywordTags.map((tag) => (
                    <span key={tag} className="bg-[#f4f4f4] px-2 py-1 text-[11px] text-[#525252]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default KnowledgePanel;
