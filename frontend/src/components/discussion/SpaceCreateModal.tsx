import React, { useMemo, useState } from 'react';

type SpaceCreateModalProps = {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    description?: string;
    tags: string[];
    projectId?: string;
  }) => Promise<unknown>;
};

const SpaceCreateModal: React.FC<SpaceCreateModalProps> = ({ open, loading, onClose, onSubmit }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState('');

  const parsedTags = useMemo(
    () =>
      tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    [tags],
  );

  const reset = () => {
    setTitle('');
    setDescription('');
    setTags('');
    setProjectId('');
    setError('');
  };

  const handleClose = () => {
    if (loading) {
      return;
    }
    reset();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('请输入讨论主题');
      return;
    }
    setError('');
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        tags: parsedTags,
        projectId: projectId.trim() || undefined,
      });
      reset();
    } catch (submitError: unknown) {
      const message =
        typeof submitError === 'object' && submitError && 'message' in submitError
          ? String((submitError as { message?: string }).message || '创建失败')
          : '创建失败';
      setError(message);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl border border-[#c6c6c6] bg-white p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-light text-[#161616]">创建讨论空间</h3>
          <button
            type="button"
            onClick={handleClose}
            className="border border-[#c6c6c6] px-3 py-1 text-sm text-[#525252] hover:bg-[#f4f4f4]"
          >
            关闭
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">讨论主题</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：全球能源公司动态跟踪体系"
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">描述</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="简述讨论目标与预期产出"
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">标签（逗号分隔）</label>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="能源, 宏观, 行业观察"
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">关联项目 ID（可选）</label>
            <input
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              placeholder="project-xxx"
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          {error ? <div className="text-sm text-[#da1e28]">{error}</div> : null}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="border border-[#0f62fe] px-4 py-2 text-sm text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-[#0f62fe] px-5 py-2 text-sm text-white hover:bg-[#0353e9] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? '创建中...' : '创建空间'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SpaceCreateModal;
