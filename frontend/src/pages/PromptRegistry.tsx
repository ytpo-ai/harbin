import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { promptRegistryService, PromptTemplateItem } from '../services/promptRegistryService';

const statusTagClass: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-700',
  published: 'bg-emerald-100 text-emerald-700',
  archived: 'bg-slate-100 text-slate-700',
};

const categoryTagClass: Record<string, string> = {
  system: 'bg-blue-100 text-blue-700',
  recruitment: 'bg-violet-100 text-violet-700',
};

const PromptRegistry: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [scene, setScene] = useState('');
  const [role, setRole] = useState('');
  const [categoryTab, setCategoryTab] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published' | 'archived'>('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'create' | 'copy'>('create');
  const [createCategory, setCreateCategory] = useState('system');
  const [createScene, setCreateScene] = useState('');
  const [createRole, setCreateRole] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createSummary, setCreateSummary] = useState('');

  const { data: filterOptions, isLoading: isFilterLoading } = useQuery(['prompt-template-filters'], () =>
    promptRegistryService.listTemplateFilters(),
  );

  const sceneOptions = filterOptions?.scenes || [];
  const roleOptions = useMemo(() => {
    if (!scene) {
      return [];
    }
    return filterOptions?.sceneRoleMap?.[scene] || [];
  }, [filterOptions?.sceneRoleMap, scene]);

  const statusOptions = useMemo(() => {
    const options = filterOptions?.statuses?.length ? filterOptions.statuses : [];
    return Array.from(new Set(options));
  }, [filterOptions?.statuses]);

  const categoryOptions = useMemo(() => {
    const categories = Array.isArray(filterOptions?.categories) ? filterOptions.categories : [];
    return Array.from(new Set(categories.map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [filterOptions?.categories]);

  const categoryTabOptions = useMemo(() => {
    const defaults = ['system', 'recruitment'];
    return Array.from(new Set([...defaults, ...categoryOptions])).sort((a, b) => a.localeCompare(b));
  }, [categoryOptions]);

  const createCategoryOptions = useMemo(() => {
    const fromFilters = categoryOptions;
    const defaults = ['system', 'recruitment'];
    return Array.from(new Set([...defaults, ...fromFilters])).sort((a, b) => a.localeCompare(b));
  }, [categoryOptions]);

  const templatesQueryKey = ['prompt-templates', categoryTab, scene, role, statusFilter];
  const { data: templates = [], isLoading } = useQuery(
    templatesQueryKey,
    () =>
      promptRegistryService.listTemplates({
        category: categoryTab || undefined,
        scene,
        role,
        status: statusFilter,
        limit: 200,
      }),
    { enabled: Boolean(scene && role) },
  );

  React.useEffect(() => {
    if (!sceneOptions.length) {
      setScene('');
      setRole('');
      return;
    }
    if (!scene || !sceneOptions.includes(scene)) {
      setScene(sceneOptions[0]);
      return;
    }
    const nextRoleOptions = filterOptions?.sceneRoleMap?.[scene] || [];
    if (!nextRoleOptions.length) {
      setRole('');
      return;
    }
    if (!role || !nextRoleOptions.includes(role)) {
      setRole(nextRoleOptions[0]);
    }
  }, [filterOptions?.sceneRoleMap, role, scene, sceneOptions]);

  const refresh = () => {
    queryClient.invalidateQueries('prompt-templates');
    queryClient.invalidateQueries('prompt-audits');
    queryClient.invalidateQueries('prompt-template-filters');
  };

  const createTemplateMutation = useMutation(promptRegistryService.saveDraft, {
    onSuccess: () => {
      setIsCreateOpen(false);
      setCreateCategory('system');
      setCreateScene('');
      setCreateRole('');
      setCreateDescription('');
      setCreateContent('');
      setCreateSummary('');
      setCreateMode('create');
      refresh();
    },
  });

  const publishMutation = useMutation(promptRegistryService.publish, {
    onSuccess: () => {
      refresh();
    },
  });

  const unpublishMutation = useMutation(promptRegistryService.unpublish, {
    onSuccess: () => {
      refresh();
    },
  });

  const deleteTemplateMutation = useMutation(promptRegistryService.deleteTemplate, {
    onSuccess: () => {
      refresh();
    },
  });

  const onCreateTemplate = () => {
    const normalizedScene = createScene.trim();
    const normalizedRole = createRole.trim();
    const normalizedContent = createContent.trim();
    if (!normalizedScene || !normalizedRole || !normalizedContent) {
      return;
    }
    createTemplateMutation.mutate({
      category: createCategory,
      scene: normalizedScene,
      role: normalizedRole,
      description: createDescription.trim() || undefined,
      content: normalizedContent,
      summary:
        createSummary.trim() ||
        (createMode === 'copy' ? `复制 ${normalizedScene}/${normalizedRole}` : `新增 ${normalizedScene}/${normalizedRole}`),
    });
  };

  const openCreateModal = () => {
    setCreateMode('create');
    setCreateCategory('system');
    setCreateScene('');
    setCreateRole('');
    setCreateDescription('');
    setCreateContent('');
    setCreateSummary('');
    setIsCreateOpen(true);
  };

  const openCopyModal = (item: PromptTemplateItem) => {
    setCreateMode('copy');
    setCreateCategory(item.category || 'system');
    setCreateScene(item.scene || '');
    setCreateRole(item.role || '');
    setCreateDescription(item.description || '');
    setCreateContent(item.content || '');
    setCreateSummary(`复制自 ${item.scene}/${item.role} v${item.version}`);
    setIsCreateOpen(true);
  };

  const onTogglePublish = (item: PromptTemplateItem) => {
    if (item.status === 'published') {
      unpublishMutation.mutate({
        scene: item.scene,
        role: item.role,
        version: item.version,
        summary: `取消发布 ${item.scene}/${item.role} v${item.version}`,
      });
      return;
    }
    publishMutation.mutate({
      scene: item.scene,
      role: item.role,
      version: item.version,
      summary: `发布 ${item.scene}/${item.role} v${item.version}`,
    });
  };

  const onDelete = (item: PromptTemplateItem) => {
    if (item.status === 'published') {
      window.alert('已发布版本不允许删除。');
      return;
    }
    const confirmed = window.confirm(`确认删除 ${item.scene}/${item.role} v${item.version} 吗？`);
    if (!confirmed) {
      return;
    }
    deleteTemplateMutation.mutate(item._id);
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Prompt 管理</h1>
            <p className="mt-1 text-sm text-slate-500">列表页用于筛选与操作，编辑和日志请进入详情页。</p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            新增
          </button>
        </div>

        <div className="mt-4 border-b border-slate-200">
          <nav className="-mb-px flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => setCategoryTab('')}
              className={`border-b-2 px-1 py-2 text-sm font-medium ${
                !categoryTab
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              全部
            </button>
            {categoryTabOptions.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setCategoryTab(category)}
                className={`border-b-2 px-1 py-2 text-sm font-medium ${
                  categoryTab === category
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {category}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <select
            value={scene}
            onChange={(event) => setScene(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={isFilterLoading || !sceneOptions.length}
          >
            {!sceneOptions.length ? <option value="">暂无 scene</option> : null}
            {sceneOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={!scene || !roleOptions.length}
          >
            {!roleOptions.length ? <option value="">暂无 role</option> : null}
            {roleOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as any)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">全部状态</option>
            {statusOptions.map((item) => (
              <option key={item} value={item}>
                {item === 'draft' ? '草稿' : item === 'published' ? '已发布' : '已归档'}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={refresh}
            title="刷新"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            <ArrowPathIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">版本列表</h2>
        <div className="max-h-[640px] space-y-2 overflow-auto">
          {isLoading ? <p className="text-sm text-slate-500">加载中...</p> : null}
          {!isLoading && (!scene || !role) ? <p className="text-sm text-slate-500">请选择 scene 与 role</p> : null}
          {!isLoading && scene && role && templates.length === 0 ? <p className="text-sm text-slate-500">暂无模板</p> : null}

          {templates.map((item) => (
            <div key={item._id} className="rounded-lg border border-slate-200 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">v{item.version}</span>
                    <span className={`rounded px-2 py-0.5 text-xs ${statusTagClass[item.status] || statusTagClass.archived}`}>
                      {item.status}
                    </span>
                    {item.category ? (
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${categoryTagClass[item.category] || 'bg-slate-100 text-slate-700'}`}
                      >
                        {item.category}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{new Date(item.updatedAt).toLocaleString()}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.description || '暂无描述'}</p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="编辑"
                    onClick={() => {
                      navigate(`/prompt-registry/templates/${item._id}`);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    onClick={() => onDelete(item)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="复制"
                    onClick={() => openCopyModal(item)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                  >
                    <DocumentDuplicateIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title={item.status === 'published' ? '取消发布' : '发布'}
                    onClick={() => onTogglePublish(item)}
                    disabled={publishMutation.isLoading || unpublishMutation.isLoading}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-md border disabled:opacity-50 ${
                      item.status === 'published'
                        ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                        : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                    }`}
                  >
                    {item.status === 'published' ? <ArrowDownTrayIcon className="h-4 w-4" /> : <ArrowUpTrayIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">{createMode === 'copy' ? '复制 Prompt' : '新增 Prompt'}</h2>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <select
                value={createCategory}
                onChange={(event) => setCreateCategory(event.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {createCategoryOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <input
                value={createScene}
                onChange={(event) => setCreateScene(event.target.value)}
                placeholder="scene，例如 orchestration"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <input
              value={createRole}
              onChange={(event) => setCreateRole(event.target.value)}
              placeholder="Prompt职责 role，例如 planner-task-decomposition"
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

            <input
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              placeholder="Prompt作用描述（可选）"
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

            <input
              value={createSummary}
              onChange={(event) => setCreateSummary(event.target.value)}
              placeholder="变更摘要（可选）"
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

            <textarea
              value={createContent}
              onChange={(event) => setCreateContent(event.target.value)}
              rows={12}
              placeholder="输入系统 Prompt 内容"
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onCreateTemplate}
                disabled={
                  createTemplateMutation.isLoading ||
                  !createCategory.trim() ||
                  !createScene.trim() ||
                  !createRole.trim() ||
                  !createContent.trim()
                }
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white"
              >
                {createMode === 'copy' ? '复制并创建草稿' : '创建草稿'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PromptRegistry;
