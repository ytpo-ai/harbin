import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { promptRegistryService } from '../services/promptRegistryService';

const PromptRegistryDetail: React.FC = () => {
  const { templateId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [editorContent, setEditorContent] = useState('');

  const { data: template, isLoading } = useQuery(['prompt-template-detail', templateId], () =>
    promptRegistryService.getTemplateById(templateId),
  );

  const { data: versions = [] } = useQuery(
    ['prompt-template-versions', template?.scene, template?.role],
    () => promptRegistryService.listTemplates({ scene: template?.scene, role: template?.role, status: 'all', limit: 200 }),
    { enabled: Boolean(template?.scene && template?.role) },
  );

  const { data: audits = [] } = useQuery(
    ['prompt-template-audits', template?.scene, template?.role],
    () => promptRegistryService.listAudits({ scene: template?.scene, role: template?.role, limit: 50 }),
    { enabled: Boolean(template?.scene && template?.role) },
  );

  useEffect(() => {
    if (!template) {
      setEditorDescription('');
      setEditorContent('');
      return;
    }
    setEditorDescription(template.description || '');
    setEditorContent(template.content || '');
  }, [template?._id]);

  const refresh = () => {
    queryClient.invalidateQueries('prompt-template-detail');
    queryClient.invalidateQueries('prompt-template-versions');
    queryClient.invalidateQueries('prompt-template-audits');
    queryClient.invalidateQueries('prompt-templates');
    queryClient.invalidateQueries('prompt-template-filters');
  };

  const saveDraftMutation = useMutation(promptRegistryService.saveDraft, {
    onSuccess: (created) => {
      setSummary('');
      refresh();
      navigate(`/prompt-registry/templates/${created._id}`);
    },
  });

  const publishMutation = useMutation(promptRegistryService.publish, {
    onSuccess: () => {
      setSummary('');
      refresh();
    },
  });

  const currentVersion = useMemo(() => Number(template?.version || 0), [template?.version]);

  const onSaveDraft = () => {
    if (!template || !editorContent.trim()) {
      return;
    }
    saveDraftMutation.mutate({
      scene: template.scene,
      role: template.role,
      description: editorDescription.trim() || undefined,
      content: editorContent,
      baseVersion: template.version,
      summary: summary.trim() || `编辑 ${template.scene}/${template.role}`,
    });
  };

  const onPublish = () => {
    if (!template) {
      return;
    }
    publishMutation.mutate({
      scene: template.scene,
      role: template.role,
      version: template.version,
      summary: summary.trim() || `发布 ${template.scene}/${template.role} v${template.version}`,
    });
  };

  if (isLoading) {
    return <div className="p-4 text-sm text-slate-500">加载中...</div>;
  }

  if (!template) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm text-slate-500">模板不存在或已删除。</p>
        <Link to="/prompt-registry" className="text-sm text-primary-600 hover:text-primary-700">
          返回 Prompt 管理
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Prompt 详情</p>
            <h1 className="mt-1 text-lg font-semibold text-slate-900">
              {template.scene} / {template.role} / v{template.version}
            </h1>
          </div>
          <Link to="/prompt-registry" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
            返回列表
          </Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <p>状态</p>
            <p className="mt-1 font-medium text-slate-900">{template.status}</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <p>更新时间</p>
            <p className="mt-1 font-medium text-slate-900">{new Date(template.updatedAt).toLocaleString()}</p>
          </div>
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            <p>操作人</p>
            <p className="mt-1 font-medium text-slate-900">{template.updatedBy || 'unknown'}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">编辑</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={saveDraftMutation.isLoading || !editorContent.trim()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              保存草稿
            </button>
            <button
              type="button"
              onClick={onPublish}
              disabled={publishMutation.isLoading}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white"
            >
              发布当前版本
            </button>
          </div>
        </div>

        <input
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="变更摘要（可选）"
          className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <input
          value={editorDescription}
          onChange={(event) => setEditorDescription(event.target.value)}
          placeholder="Prompt作用描述（可选）"
          className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <textarea
          value={editorContent}
          onChange={(event) => setEditorContent(event.target.value)}
          rows={16}
          className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
          placeholder="输入 Prompt 内容"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">版本</h3>
          <div className="max-h-72 space-y-2 overflow-auto">
            {versions.map((item) => (
              <button
                key={item._id}
                type="button"
                onClick={() => navigate(`/prompt-registry/templates/${item._id}`)}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs ${
                  item.version === currentVersion ? 'border-primary-300 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <p className="font-medium text-slate-800">v{item.version} / {item.status}</p>
                <p className="mt-1 text-slate-500">{new Date(item.updatedAt).toLocaleString()}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">日志</h3>
          <div className="max-h-72 space-y-2 overflow-auto">
            {audits.map((item) => (
              <div key={item._id} className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600">
                <p>
                  [{new Date(item.createdAt).toLocaleString()}] {item.action} v{item.version}
                  {item.fromVersion ? ` (from v${item.fromVersion})` : ''}
                </p>
                <p>operator: {item.operatorId || 'unknown'}</p>
                <p>{item.summary || '-'}</p>
              </div>
            ))}
            {!audits.length ? <p className="text-sm text-slate-500">暂无审计日志</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PromptRegistryDetail;
