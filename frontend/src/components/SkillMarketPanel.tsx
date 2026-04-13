import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { skillMarketService } from '../services/skillMarketService';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const AddPlatformModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; url: string; priority: number; description?: string }) => void;
  loading: boolean;
}> = ({ open, onClose, onSubmit, loading }) => {
  const [form, setForm] = useState({ name: '', url: '', priority: 100, description: '' });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="添加平台">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">添加 Skill 市场平台</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">平台名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="例如: AgentSkills Best"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">平台 URL</label>
            <input
              value={form.url}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              placeholder="例如: https://agentskills.best"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">优先级（数值越小越优先）</label>
            <input
              type="number"
              value={form.priority}
              onChange={(e) => setForm((prev) => ({ ...prev, priority: Number(e.target.value) || 100 }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">描述（可选）</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="平台简要说明"
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">取消</button>
          <button
            onClick={() => {
              if (!form.name.trim() || !form.url.trim()) {
                alert('平台名称和 URL 必填');
                return;
              }
              onSubmit({
                name: form.name.trim(),
                url: form.url.trim(),
                priority: form.priority,
                description: form.description.trim() || undefined,
              });
            }}
            disabled={loading}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {loading ? '创建中...' : '确认添加'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const SkillMarketPlatformPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const { data: platforms = [], isLoading: platformsLoading } = useQuery(
    'skill-market-platforms',
    () => skillMarketService.listPlatforms(),
  );

  const createPlatformMutation = useMutation(skillMarketService.createPlatform, {
    onSuccess: () => {
      setIsAddModalOpen(false);
      queryClient.invalidateQueries('skill-market-platforms');
    },
  });

  const updatePlatformMutation = useMutation(
    ({ id, payload }: { id: string; payload: { status?: 'active' | 'disabled' } }) =>
      skillMarketService.updatePlatform(id, payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('skill-market-platforms');
      },
    },
  );

  const deletePlatformMutation = useMutation(skillMarketService.deletePlatform, {
    onSuccess: () => {
      queryClient.invalidateQueries('skill-market-platforms');
    },
  });

  return (
    <>
      <section className="rounded-lg bg-white p-5 shadow">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium text-gray-900">Skill 市场平台</h2>
            {platformsLoading && <span className="text-xs text-gray-500">加载中...</span>}
          </div>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            添加平台
          </button>
        </div>

        <div className="space-y-2">
          {platforms.map((platform) => (
            <div key={platform.id} className="rounded-md border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{platform.name}</p>
                    <span className={`rounded px-2 py-0.5 text-xs ${platform.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {platform.status === 'active' ? '启用' : '禁用'}
                    </span>
                  </div>
                  <a href={platform.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">{platform.url}</a>
                  {platform.description && <p className="mt-0.5 text-xs text-gray-500">{platform.description}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      updatePlatformMutation.mutate({
                        id: platform.id,
                        payload: { status: platform.status === 'active' ? 'disabled' : 'active' },
                      })
                    }
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                  >
                    {platform.status === 'active' ? '禁用' : '启用'}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`确认删除平台「${platform.name}」及其关联仓库记录？`)) {
                        deletePlatformMutation.mutate(platform.id);
                      }
                    }}
                    className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
                <span>优先级: {platform.priority}</span>
                <span>仓库数: {platform.repoCount || 0}</span>
                <span>最近索引: {formatDateTime(platform.lastIndexedAt)}</span>
              </div>
            </div>
          ))}
          {!platformsLoading && platforms.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">暂无市场平台，点击右上角「添加平台」开始配置。</p>
          )}
        </div>
      </section>

      <AddPlatformModal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={(payload) => createPlatformMutation.mutate(payload)}
        loading={createPlatformMutation.isLoading}
      />
    </>
  );
};

export default SkillMarketPlatformPanel;
