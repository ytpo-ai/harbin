import React from 'react';
import { DiscussionKnowledgeEntry } from '../../services/discussionService';

type KnowledgeArchiveMode = 'existing' | 'create';

type KnowledgeArchiveModalProps = {
  open: boolean;
  mode: KnowledgeArchiveMode;
  messageSequence?: number;
  messagePreview: string;
  existingKeyword: string;
  existingItems: DiscussionKnowledgeEntry[];
  selectedKnowledgeEntryIds: string[];
  createTitle: string;
  createSummary: string;
  createContent: string;
  submitting: boolean;
  loadingExisting: boolean;
  onClose: () => void;
  onModeChange: (mode: KnowledgeArchiveMode) => void;
  onExistingKeywordChange: (keyword: string) => void;
  onToggleExisting: (knowledgeEntryId: string) => void;
  onCreateTitleChange: (value: string) => void;
  onCreateSummaryChange: (value: string) => void;
  onCreateContentChange: (value: string) => void;
  onSubmit: () => void;
};

const KnowledgeArchiveModal: React.FC<KnowledgeArchiveModalProps> = ({
  open,
  mode,
  messageSequence,
  messagePreview,
  existingKeyword,
  existingItems,
  selectedKnowledgeEntryIds,
  createTitle,
  createSummary,
  createContent,
  submitting,
  loadingExisting,
  onClose,
  onModeChange,
  onExistingKeywordChange,
  onToggleExisting,
  onCreateTitleChange,
  onCreateSummaryChange,
  onCreateContentChange,
  onSubmit,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-3xl border border-[#c6c6c6] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#e0e0e0] px-4 py-3">
          <div>
            <div className="text-sm font-medium text-[#161616]">落档知识库</div>
            <div className="mt-1 text-xs text-[#6f6f6f]">消息 #{messageSequence || '-'} 将被关联到知识条目</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[#c6c6c6] px-2 py-1 text-xs text-[#262626] hover:bg-[#f4f4f4]"
          >
            关闭
          </button>
        </div>

        <div className="border-b border-[#e0e0e0] bg-[#f4f4f4] px-4 py-3 text-xs leading-5 text-[#525252]">
          <div className="max-h-24 overflow-auto whitespace-pre-wrap">{messagePreview || '（空消息）'}</div>
        </div>

        <div className="border-b border-[#e0e0e0] px-4 py-2">
          <div className="inline-flex border border-[#c6c6c6] bg-white">
            <button
              type="button"
              onClick={() => onModeChange('existing')}
              className={`px-3 py-1 text-xs ${mode === 'existing' ? 'bg-[#edf5ff] text-[#0f62fe]' : 'text-[#525252] hover:bg-[#f4f4f4]'}`}
            >
              选择已有
            </button>
            <button
              type="button"
              onClick={() => onModeChange('create')}
              className={`border-l border-[#c6c6c6] px-3 py-1 text-xs ${mode === 'create' ? 'bg-[#edf5ff] text-[#0f62fe]' : 'text-[#525252] hover:bg-[#f4f4f4]'}`}
            >
              新建条目
            </button>
          </div>
        </div>

        <div className="max-h-[58vh] overflow-auto p-4">
          {mode === 'existing' ? (
            <div className="space-y-3">
              <input
                value={existingKeyword}
                onChange={(event) => onExistingKeywordChange(event.target.value)}
                placeholder="按标题/关键词搜索知识条目"
                className="w-full border border-[#c6c6c6] bg-white px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
              />
              {loadingExisting ? <div className="text-sm text-[#6f6f6f]">加载知识条目中...</div> : null}
              {!loadingExisting && existingItems.length === 0 ? <div className="text-sm text-[#6f6f6f]">暂无可选知识条目</div> : null}
              <div className="space-y-2">
                {existingItems.map((item) => {
                  const checked = selectedKnowledgeEntryIds.includes(item.id);
                  return (
                    <label key={item.id} className="flex cursor-pointer items-start gap-3 border border-[#e0e0e0] p-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleExisting(item.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[#161616]">{item.title}</div>
                        <div className="mt-1 text-xs text-[#6f6f6f]">
                          {item.sourceType} · 引用 {item.referenceCount}
                        </div>
                        <div className="mt-2 text-xs leading-5 text-[#262626]">{item.summary || item.content}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs text-[#525252]">标题</div>
                <input
                  value={createTitle}
                  onChange={(event) => onCreateTitleChange(event.target.value)}
                  placeholder="输入知识标题"
                  className="w-full border border-[#c6c6c6] bg-white px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-[#525252]">摘要（可选）</div>
                <input
                  value={createSummary}
                  onChange={(event) => onCreateSummaryChange(event.target.value)}
                  placeholder="输入摘要，不填则后端自动生成"
                  className="w-full border border-[#c6c6c6] bg-white px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-[#525252]">内容</div>
                <textarea
                  value={createContent}
                  onChange={(event) => onCreateContentChange(event.target.value)}
                  rows={10}
                  className="w-full resize-y border border-[#c6c6c6] bg-white px-3 py-2 text-sm leading-6 text-[#161616] outline-none focus:border-[#0f62fe]"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#e0e0e0] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="border border-[#c6c6c6] px-3 py-2 text-xs text-[#262626] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="border border-[#0f62fe] bg-[#0f62fe] px-3 py-2 text-xs text-white hover:bg-[#0353e9] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '提交中...' : '确认落档'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeArchiveModal;
