import React from 'react';
import { OutlineSection, OutlineSectionStatus } from '../../services/discussionService';

type OutlineSectionModalProps = {
  open: boolean;
  mode: 'create' | 'edit';
  title: string;
  description: string;
  status: OutlineSectionStatus;
  parentSectionId: string;
  parentOptions: OutlineSection[];
  submitting: boolean;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onStatusChange: (value: OutlineSectionStatus) => void;
  onParentSectionIdChange: (value: string) => void;
  onSubmit: () => void;
};

const OutlineSectionModal: React.FC<OutlineSectionModalProps> = ({
  open,
  mode,
  title,
  description,
  status,
  parentSectionId,
  parentOptions,
  submitting,
  onClose,
  onTitleChange,
  onDescriptionChange,
  onStatusChange,
  onParentSectionIdChange,
  onSubmit,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-2xl border border-[#c6c6c6] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#e0e0e0] px-4 py-3">
          <div className="text-sm font-medium text-[#161616]">{mode === 'create' ? '新增章节' : '编辑章节'}</div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="border border-[#c6c6c6] px-2 py-1 text-xs text-[#262626] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
          >
            关闭
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <div className="mb-1 text-xs text-[#525252]">章节标题</div>
            <input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="请输入章节标题"
              className="w-full border border-[#c6c6c6] bg-white px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-[#525252]">章节说明（可选）</div>
            <textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              rows={6}
              className="w-full resize-y border border-[#c6c6c6] bg-white px-3 py-2 text-sm leading-6 text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-[#525252]">父章节</div>
            <select
              value={parentSectionId}
              onChange={(event) => onParentSectionIdChange(event.target.value)}
              className="w-full border border-[#c6c6c6] bg-white px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            >
              <option value="">无（作为一级章节）</option>
              {parentOptions.map((section) => (
                <option key={section.id} value={section.id}>
                  {`${'  '.repeat(Math.max(0, section.depth))}${section.title}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1 text-xs text-[#525252]">章节状态</div>
            <select
              value={status}
              onChange={(event) => onStatusChange(event.target.value as OutlineSectionStatus)}
              className="w-full border border-[#c6c6c6] bg-white px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            >
              <option value="draft">draft</option>
              <option value="enriching">enriching</option>
              <option value="sufficient">sufficient</option>
              <option value="review">review</option>
            </select>
          </div>
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
            {submitting ? '提交中...' : mode === 'create' ? '确认新增' : '确认更新'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OutlineSectionModal;
