import React from 'react';
import { DiscussionDocumentOutline, DiscussionKnowledgeCoverage, OutlineSection } from '../../services/discussionService';
import { OutlineTemplateItem } from '../../services/engineeringIntelligenceService';

type OutlinePanelProps = {
  outline?: DiscussionDocumentOutline;
  coverage?: DiscussionKnowledgeCoverage;
  loading: boolean;
  generating: boolean;
  onGenerate: () => void;
  templates?: OutlineTemplateItem[];
  selectedTemplateId?: string;
  onTemplateChange?: (templateId: string) => void;
  onApplyTemplate?: () => void;
  applyingTemplate?: boolean;
  onGoDataDashboard?: () => void;
  onDiscussSection?: (section: OutlineSection) => void;
  discussingSectionId?: string;
  onEnrichAllSections?: () => void;
  enrichingAllSections?: boolean;
  onAddSection?: () => void;
  addingSection?: boolean;
  onEditSection?: (section: OutlineSection) => void;
  editingSectionId?: string;
  onDeleteSection?: (section: OutlineSection) => void;
  deletingSectionId?: string;
  onMoveSection?: (section: OutlineSection, direction: 'up' | 'down') => void;
  movingSectionId?: string;
  onAddChildSection?: (section: OutlineSection) => void;
};

const statusLabelMap: Record<OutlineSection['status'], string> = {
  draft: '草稿',
  enriching: '补充中（知识未达充足）',
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
  templates = [],
  selectedTemplateId = '',
  onTemplateChange,
  onApplyTemplate,
  applyingTemplate = false,
  onGoDataDashboard,
  onDiscussSection,
  discussingSectionId,
  onEnrichAllSections,
  enrichingAllSections = false,
  onAddSection,
  addingSection = false,
  onEditSection,
  editingSectionId,
  onDeleteSection,
  deletingSectionId,
  onMoveSection,
  movingSectionId,
  onAddChildSection,
}) => {
  const sections = (outline?.sections || []).slice().sort((a, b) => a.order - b.order);
  const [actionMenuSectionId, setActionMenuSectionId] = React.useState('');
  const actionMenuRootRef = React.useRef<HTMLDivElement | null>(null);
  const coveragePercent = Math.round((coverage?.coverage || 0) * 100);
  const coverageDetailMap = new Map((coverage?.sectionDetails || []).map((item) => [item.sectionId, item]));
  const siblingIndexMap = new Map<string, { index: number; total: number }>();

  React.useEffect(() => {
    if (!actionMenuSectionId) {
      return;
    }

    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!actionMenuRootRef.current) {
        return;
      }
      if (actionMenuRootRef.current.contains(event.target as Node)) {
        return;
      }
      setActionMenuSectionId('');
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, [actionMenuSectionId]);

  const siblingBuckets = new Map<string, OutlineSection[]>();
  for (const section of sections) {
    const parentKey = String(section.parentSectionId || '');
    if (!siblingBuckets.has(parentKey)) {
      siblingBuckets.set(parentKey, []);
    }
    siblingBuckets.get(parentKey)?.push(section);
  }

  for (const siblings of siblingBuckets.values()) {
    siblings
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((item, index, list) => {
        siblingIndexMap.set(item.id, { index, total: list.length });
      });
  }

  const renderLatestEntryDate = (value?: string) => {
    if (!value) {
      return '暂无更新';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '暂无更新';
    }
    return date.toLocaleDateString('zh-CN');
  };

  const getSectionProgressPercent = (knowledgeCount: number) => {
    if (knowledgeCount <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((knowledgeCount / 3) * 100));
  };

  const missingSections = (coverage?.sectionDetails || []).filter((item) => item.knowledgeCount <= 0);

  return (
    <div className="space-y-4" ref={actionMenuRootRef}>
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

        {onApplyTemplate ? (
          <div className="mt-3 flex items-center gap-2">
            <select
              value={selectedTemplateId}
              onChange={(event) => onTemplateChange?.(event.target.value)}
              className="min-w-0 flex-1 border border-[#c6c6c6] bg-[#f4f4f4] px-2 py-1 text-xs text-[#161616] outline-none focus:border-[#0f62fe]"
            >
              <option value="">选择模板后可应用到当前空间</option>
              {templates.map((template) => (
                <option key={template._id} value={template._id}>
                  {template.isSystem ? '[系统] ' : ''}
                  {template.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onApplyTemplate}
              disabled={!selectedTemplateId || applyingTemplate}
              className="border border-[#0f62fe] px-2 py-1 text-xs text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {applyingTemplate ? '应用中...' : '应用模板'}
            </button>
            {onGoDataDashboard ? (
              <button
                type="button"
                onClick={onGoDataDashboard}
                className="border border-[#8d8d8d] px-2 py-1 text-xs text-[#525252] hover:bg-[#f4f4f4]"
              >
                数据看板
              </button>
            ) : null}
          </div>
        ) : null}

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
          {missingSections.length > 0 ? (
            <div className="mt-2 border border-[#ffd7d9] bg-[#fff1f1] px-2 py-1 text-[11px] text-[#a2191f]">
              待补充章节：{missingSections.slice(0, 3).map((item) => item.sectionTitle).join('、')}
              {missingSections.length > 3 ? ` 等 ${missingSections.length} 个` : ''}
            </div>
          ) : null}
        </div>
      </div>

      <div className="border border-[#c6c6c6] bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-[#161616]">章节 ({sections.length})</div>
          <div className="flex items-center gap-2">
            {onAddSection ? (
              <button
                type="button"
                onClick={onAddSection}
                disabled={addingSection}
                className="border border-[#525252] px-2 py-1 text-xs text-[#525252] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addingSection ? '新增中...' : '新增章节'}
              </button>
            ) : null}
            {onEnrichAllSections ? (
              <button
                type="button"
                onClick={onEnrichAllSections}
                disabled={enrichingAllSections}
                className="border border-[#0f62fe] px-2 py-1 text-xs text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enrichingAllSections ? '批量任务执行中...' : '一键补充 draft'}
              </button>
            ) : null}
          </div>
        </div>
        {loading ? <div className="text-sm text-[#6f6f6f]">加载中...</div> : null}
        {!loading && sections.length === 0 ? <div className="text-sm text-[#6f6f6f]">暂无章节，点击上方生成大纲</div> : null}
        <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
          {sections.map((section) => {
            const detail = coverageDetailMap.get(section.id);
            const knowledgeCount = detail?.knowledgeCount ?? section.knowledgeCount ?? 0;
            const status = detail?.status ?? section.status;
            const progress = getSectionProgressPercent(knowledgeCount);
            const siblingIndex = siblingIndexMap.get(section.id);
            const moveUpDisabled = movingSectionId === section.id || (siblingIndex ? siblingIndex.index <= 0 : false);
            const moveDownDisabled =
              movingSectionId === section.id || (siblingIndex ? siblingIndex.index >= siblingIndex.total - 1 : false);

            return (
              <div key={section.id} className="border border-[#e0e0e0] bg-[#f4f4f4] p-3" style={{ marginLeft: `${section.depth * 12}px` }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-[#161616]">{section.title}</div>
                  <span className={`px-2 py-0.5 text-[11px] ${statusClassMap[status]}`}>{statusLabelMap[status]}</span>
                </div>
                {section.description ? <div className="mt-1 text-xs text-[#6f6f6f]">{section.description}</div> : null}

                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-[#6f6f6f]">
                    <span>知识条目 {knowledgeCount}</span>
                    <span>最近更新 {renderLatestEntryDate(detail?.latestEntryDate)}</span>
                  </div>
                  <div className="h-1.5 w-full bg-white">
                    <div className="h-1.5 bg-[#0f62fe]" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-end text-[11px] text-[#6f6f6f]">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setActionMenuSectionId((prev) => (prev === section.id ? '' : section.id))}
                      className="border border-[#8d8d8d] px-2 py-0.5 text-[11px] text-[#525252] hover:bg-white"
                    >
                      操作
                    </button>
                    {actionMenuSectionId === section.id ? (
                      <div className="absolute right-0 z-10 mt-1 min-w-[132px] border border-[#c6c6c6] bg-white p-1 shadow-sm">
                        {onDiscussSection ? (
                          <button
                            type="button"
                            onClick={() => {
                              onDiscussSection(section);
                              setActionMenuSectionId('');
                            }}
                            disabled={discussingSectionId === section.id}
                            className="block w-full px-2 py-1 text-left text-[#525252] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {discussingSectionId === section.id ? '切换中...' : '讨论此章节'}
                          </button>
                        ) : null}
                        {onMoveSection ? (
                          <button
                            type="button"
                            onClick={() => {
                              onMoveSection(section, 'up');
                              setActionMenuSectionId('');
                            }}
                            disabled={moveUpDisabled}
                            className="block w-full px-2 py-1 text-left text-[#525252] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            上移
                          </button>
                        ) : null}
                        {onMoveSection ? (
                          <button
                            type="button"
                            onClick={() => {
                              onMoveSection(section, 'down');
                              setActionMenuSectionId('');
                            }}
                            disabled={moveDownDisabled}
                            className="block w-full px-2 py-1 text-left text-[#525252] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            下移
                          </button>
                        ) : null}
                        {onEditSection ? (
                          <button
                            type="button"
                            onClick={() => {
                              onEditSection(section);
                              setActionMenuSectionId('');
                            }}
                            disabled={editingSectionId === section.id}
                            className="block w-full px-2 py-1 text-left text-[#525252] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {editingSectionId === section.id ? '编辑中...' : '编辑'}
                          </button>
                        ) : null}
                        {onAddChildSection ? (
                          <button
                            type="button"
                            onClick={() => {
                              onAddChildSection(section);
                              setActionMenuSectionId('');
                            }}
                            className="block w-full px-2 py-1 text-left text-[#525252] hover:bg-[#f4f4f4]"
                          >
                            新增子章节
                          </button>
                        ) : null}
                        {onDeleteSection ? (
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteSection(section);
                              setActionMenuSectionId('');
                            }}
                            disabled={deletingSectionId === section.id}
                            className="block w-full px-2 py-1 text-left text-[#da1e28] hover:bg-[#fff1f1] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingSectionId === section.id ? '清空中...' : '清空补充'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default OutlinePanel;
