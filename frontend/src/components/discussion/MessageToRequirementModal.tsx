import React from 'react';

type MessageToRequirementModalProps = {
  open: boolean;
  messageSequence?: number;
  sourceSpaceTitle?: string;
  sourceThreadTitle?: string;
  sourceMessageId?: string;
  messagePreview: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  projectId?: string;
  submitting: boolean;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPriorityChange: (value: 'low' | 'medium' | 'high' | 'critical') => void;
  onSubmit: () => void;
};

const MessageToRequirementModal: React.FC<MessageToRequirementModalProps> = ({
  open,
  messageSequence,
  sourceSpaceTitle,
  sourceThreadTitle,
  sourceMessageId,
  messagePreview,
  title,
  description,
  priority,
  projectId,
  submitting,
  onClose,
  onTitleChange,
  onDescriptionChange,
  onPriorityChange,
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
            <div className="text-sm font-medium text-[#161616]">转为需求</div>
            <div className="mt-1 text-xs text-[#6f6f6f]">消息 #{messageSequence || '-'} 将创建为工程智能需求</div>
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
          <div className="mb-2 rounded border border-[#d9d9d9] bg-white px-3 py-2 text-[11px] leading-5 text-[#6f6f6f]">
            <div>来源空间：{sourceSpaceTitle || '未命名空间'}</div>
            <div>来源讨论线：{sourceThreadTitle || '未命名讨论线'}</div>
            <div>来源消息：{sourceMessageId || '-'}</div>
          </div>
          <div className="max-h-20 overflow-auto whitespace-pre-wrap">{messagePreview || '（空消息）'}</div>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <div className="mb-1 text-xs text-[#525252]">需求标题</div>
            <input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="输入需求标题"
              className="w-full border border-[#c6c6c6] bg-white px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div>
            <div className="mb-1 text-xs text-[#525252]">需求描述</div>
            <textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              rows={8}
              className="w-full resize-y border border-[#c6c6c6] bg-white px-3 py-2 text-sm leading-6 text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-[#525252]">优先级</div>
              <select
                value={priority}
                onChange={(event) => onPriorityChange(event.target.value as 'low' | 'medium' | 'high' | 'critical')}
                className="w-full border border-[#c6c6c6] bg-white px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </div>

            <div>
              <div className="mb-1 text-xs text-[#525252]">关联项目</div>
              <input
                value={projectId || '未关联项目'}
                readOnly
                className="w-full border border-[#e0e0e0] bg-[#f4f4f4] px-3 py-2 text-sm text-[#6f6f6f]"
              />
            </div>
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
            {submitting ? '提交中...' : '创建需求'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MessageToRequirementModal;
