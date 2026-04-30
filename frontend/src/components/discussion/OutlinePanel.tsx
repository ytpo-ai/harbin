import React from 'react';
import { DiscussionDocumentOutline, DiscussionKnowledgeCoverage, OutlineSection } from '../../services/discussionService';

type OutlinePanelProps = {
  outline?: DiscussionDocumentOutline;
  coverage?: DiscussionKnowledgeCoverage;
  loading: boolean;
  generating: boolean;
  onGenerate: () => void;
  onEnrichSection?: (section: OutlineSection) => void;
};

const statusLabelMap: Record<OutlineSection['status'], string> = {
  draft: '草稿',
  enriching: '丰富中',
  sufficient: '充足',
  review: '待评审',
};

const statusClassMap: Record<OutlineSection['status'], string> = {
  draft: 'bg-[#f4f4f4] text-[#6f6f6f]',
  enriching: 'bg-[#edf5ff] text-[#0f62fe]',
  sufficient: 'bg-[#defbe6] text-[#198038]',
  review: 'bg-[#fff1e6] text-[#8a3800]',
};

const OutlinePanel: React.FC<OutlinePanelProps> = ({
  outline,
  coverage,
  loading,
  generating,
  onGenerate,
  onEnrichSection,
}) => {
  const sections = (outline?.sections || []).slice().sort((a, b) => a.order - b.order);
  const coveragePercent = Math.round((coverage?.coverage || 0) * 100);

  return (
    <div className="space-y-4">
      <div className="border border-[#c6c6c6] bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-[#161616]">文档大纲</div>
            <div className="mt-1 text-xs text-[#6f6f6f]">{outline?.title || '暂未生成大纲'}</div>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="border border-[#0f62fe] px-2 py-1 text-xs text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? '生成中...' : '生成大纲'}
          </button>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-[#6f6f6f]">
            <span>知识覆盖率</span>
            <span>{coveragePercent}%</span>
          </div>
          <div className="h-2 w-full bg-[#f4f4f4]">
            <div className="h-2 bg-[#0f62fe]" style={{ width: `${coveragePercent}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-[#6f6f6f]">
            覆盖章节 {coverage?.coveredSections || 0}/{coverage?.totalSections || 0} · 充足章节 {coverage?.sufficientSections || 0}
          </div>
        </div>
      </div>

      <div className="border border-[#c6c6c6] bg-white p-4">
        <div className="mb-3 text-sm font-medium text-[#161616]">章节 ({sections.length})</div>
        {loading ? <div className="text-sm text-[#6f6f6f]">加载中...</div> : null}
        {!loading && sections.length === 0 ? <div className="text-sm text-[#6f6f6f]">暂无章节，点击上方生成大纲</div> : null}
        <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
          {sections.map((section) => (
            <div key={section.id} className="border border-[#e0e0e0] bg-[#f4f4f4] p-3" style={{ marginLeft: `${section.depth * 12}px` }}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-[#161616]">{section.title}</div>
                <span className={`px-2 py-0.5 text-[11px] ${statusClassMap[section.status]}`}>{statusLabelMap[section.status]}</span>
              </div>
              {section.description ? <div className="mt-1 text-xs text-[#6f6f6f]">{section.description}</div> : null}
              <div className="mt-2 flex items-center justify-between text-[11px] text-[#6f6f6f]">
                <span>知识条目 {section.knowledgeCount || 0}</span>
                {onEnrichSection ? (
                  <button
                    type="button"
                    onClick={() => onEnrichSection(section)}
                    className="text-[#0f62fe] hover:underline"
                  >
                    丰富此章节
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OutlinePanel;
