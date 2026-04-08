import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { promptRegistryService } from '../services/promptRegistryService';

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return '预览失败';
  }
  const response = (error as { response?: { data?: { message?: string } } }).response;
  if (response?.data?.message) {
    return response.data.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '预览失败';
};

export interface PromptTemplateRefValue {
  scene: string;
  role: string;
}

type PromptTemplateRefPickerProps = {
  value?: PromptTemplateRefValue;
  onChange: (value?: PromptTemplateRefValue) => void;
  label?: string;
  helperText?: string;
  onApplyTemplate?: (input: { scene: string; role: string; content: string }) => void | Promise<void>;
};

export const PromptTemplateRefPicker: React.FC<PromptTemplateRefPickerProps> = ({
  value,
  onChange,
  label = 'Prompt 模板（可选）',
  helperText,
  onApplyTemplate,
}) => {
  const [selectedScene, setSelectedScene] = useState(value?.scene || '');
  const [selectedRole, setSelectedRole] = useState(value?.role || '');
  const [previewContent, setPreviewContent] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);

  const { data: filters, isLoading: filtersLoading } = useQuery(
    ['prompt-template-filters'],
    () => promptRegistryService.listTemplateFilters(),
    { staleTime: 60_000 },
  );

  const sceneOptions = useMemo(() => {
    const scenes = Array.isArray(filters?.scenes) ? [...filters.scenes] : [];
    if (selectedScene && !scenes.includes(selectedScene)) {
      scenes.push(selectedScene);
    }
    return scenes.sort((a, b) => a.localeCompare(b));
  }, [filters?.scenes, selectedScene]);

  const roleOptions = useMemo(() => {
    const sceneRoleMap = filters?.sceneRoleMap || {};
    const roles = selectedScene ? [...(sceneRoleMap[selectedScene] || [])] : [];
    if (selectedRole && !roles.includes(selectedRole)) {
      roles.push(selectedRole);
    }
    return roles.sort((a, b) => a.localeCompare(b));
  }, [filters?.sceneRoleMap, selectedRole, selectedScene]);

  useEffect(() => {
    setSelectedScene(value?.scene || '');
    setSelectedRole(value?.role || '');
  }, [value?.role, value?.scene]);

  const emitValue = (scene: string, role: string) => {
    if (scene && role) {
      onChange({ scene, role });
      return;
    }
    onChange(undefined);
  };

  const handleSceneChange = (nextScene: string) => {
    const sceneRoleMap = filters?.sceneRoleMap || {};
    const nextRoles = sceneRoleMap[nextScene] || [];
    const nextRole = nextRoles.includes(selectedRole) ? selectedRole : '';
    setSelectedScene(nextScene);
    setSelectedRole(nextRole);
    setPreviewContent('');
    setPreviewError('');
    emitValue(nextScene, nextRole);
  };

  const handleRoleChange = (nextRole: string) => {
    setSelectedRole(nextRole);
    setPreviewContent('');
    setPreviewError('');
    emitValue(selectedScene, nextRole);
  };

  const handleClear = () => {
    setSelectedScene('');
    setSelectedRole('');
    setPreviewContent('');
    setPreviewError('');
    onChange(undefined);
  };

  const fetchTemplateContent = async (): Promise<string> => {
    if (!selectedScene || !selectedRole) {
      throw new Error('请先选择 scene 和 role');
    }
    const templates = await promptRegistryService.listTemplates({
      scene: selectedScene,
      role: selectedRole,
      status: 'published',
      limit: 1,
    });
    const templateId = String(templates?.[0]?._id || '').trim();
    if (!templateId) {
      throw new Error('未找到可预览的已发布模板');
    }

    const template = await promptRegistryService.getTemplateById(templateId);
    const content = String(template?.content || '').trim();
    if (!content) {
      throw new Error('未找到可预览的已发布模板');
    }
    return content;
  };

  const handleApply = async () => {
    if (!onApplyTemplate || !selectedScene || !selectedRole) {
      return;
    }
    setApplyLoading(true);
    setPreviewError('');
    try {
      const content = await fetchTemplateContent();
      await onApplyTemplate({ scene: selectedScene, role: selectedRole, content });
    } catch (error) {
      setPreviewError(getErrorMessage(error));
    } finally {
      setApplyLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedScene || !selectedRole) {
      return;
    }
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const content = await fetchTemplateContent();
      setPreviewContent(content);
    } catch (error) {
      setPreviewError(getErrorMessage(error));
      setPreviewContent('');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <div className="mt-2 space-y-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <select
          value={selectedScene}
          onChange={(event) => handleSceneChange(event.target.value)}
          disabled={filtersLoading}
          className="w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
        >
          <option value="">选择 scene...</option>
          {sceneOptions.map((scene) => (
            <option key={scene} value={scene}>
              {scene}
            </option>
          ))}
        </select>
        <select
          value={selectedRole}
          onChange={(event) => handleRoleChange(event.target.value)}
          disabled={!selectedScene || filtersLoading}
          className="w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
        >
          <option value="">选择 role...</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <button
          type="button"
          onClick={handlePreview}
          disabled={!selectedScene || !selectedRole || previewLoading}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
        >
          {previewLoading ? '预览中...' : '预览'}
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={!selectedScene && !selectedRole}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
        >
          清除
        </button>
        {onApplyTemplate && (
          <button
            type="button"
            onClick={handleApply}
            disabled={!selectedScene || !selectedRole || applyLoading}
            className="rounded-md border border-primary-300 bg-primary-50 px-3 py-2 text-sm text-primary-700 hover:bg-primary-100 disabled:opacity-60"
          >
            {applyLoading ? '填入中...' : '填入 Prompt'}
          </button>
        )}
        </div>
      </div>

      {filtersLoading && <p className="mt-2 text-xs text-gray-500">模板列表加载中...</p>}
      {selectedScene && selectedRole && (
        <p className="mt-2 text-xs text-gray-600">已绑定: {selectedScene} / {selectedRole}</p>
      )}
      {helperText && <p className="mt-1 text-xs text-gray-500">{helperText}</p>}

      {previewError && <p className="mt-2 text-xs text-red-600">{previewError}</p>}
      {previewContent && (
        <div className="mt-2 rounded-md border border-gray-200 bg-white p-2">
          <p className="mb-1 text-xs font-medium text-gray-500">模板预览</p>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs text-gray-700">
            {previewContent}
          </pre>
        </div>
      )}
    </div>
  );
};
