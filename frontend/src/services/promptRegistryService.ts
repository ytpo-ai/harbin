import api from './api';

export type PromptTemplateStatus = 'draft' | 'published' | 'archived';

export interface PromptTemplateItem {
  _id: string;
  scene: string;
  role: string;
  version: number;
  status: PromptTemplateStatus;
  content: string;
  category?: string;
  description?: string;
  updatedBy?: string;
  updatedAt: string;
}

export interface PromptTemplateAuditItem {
  _id: string;
  scene: string;
  role: string;
  action: 'create_draft' | 'publish' | 'unpublish' | 'rollback';
  version: number;
  fromVersion?: number;
  operatorId?: string;
  summary?: string;
  createdAt: string;
}

export interface PromptTemplateDiffResult {
  scene: string;
  role: string;
  baseVersion: number;
  targetVersion: number;
  summary: {
    addedLines: number;
    removedLines: number;
  };
  preview: {
    added: string[];
    removed: string[];
  };
}

export interface PromptTemplateFilterOptions {
  scenes: string[];
  roles: string[];
  categories: string[];
  statuses: PromptTemplateStatus[];
  sceneRoleMap: Record<string, string[]>;
}

export const promptRegistryService = {
  async listTemplates(params: {
    scene?: string;
    role?: string;
    category?: string;
    status?: PromptTemplateStatus | 'all';
    limit?: number;
  }) {
    const response = await api.get<PromptTemplateItem[]>('/prompt-registry/templates', { params });
    return response.data;
  },

  async listTemplateFilters() {
    const response = await api.get<PromptTemplateFilterOptions>('/prompt-registry/templates/filters');
    return response.data;
  },

  async getTemplateById(templateId: string) {
    const response = await api.get<PromptTemplateItem>(`/prompt-registry/templates/${templateId}`);
    return response.data;
  },

  async saveDraft(payload: {
    scene: string;
    role: string;
    content: string;
    category?: string;
    description?: string;
    baseVersion?: number;
    summary?: string;
  }) {
    const response = await api.post<PromptTemplateItem>('/prompt-registry/templates/draft', payload);
    return response.data;
  },

  async publish(payload: { scene: string; role: string; version: number; summary?: string }) {
    const response = await api.post<PromptTemplateItem>('/prompt-registry/templates/publish', payload);
    return response.data;
  },

  async unpublish(payload: { scene: string; role: string; version: number; summary?: string }) {
    const response = await api.post<PromptTemplateItem>('/prompt-registry/templates/unpublish', payload);
    return response.data;
  },

  async rollback(payload: { scene: string; role: string; targetVersion: number; summary?: string }) {
    const response = await api.post<PromptTemplateItem>('/prompt-registry/templates/rollback', payload);
    return response.data;
  },

  async diff(params: { scene: string; role: string; baseVersion: number; targetVersion: number }) {
    const response = await api.get<PromptTemplateDiffResult>('/prompt-registry/templates/diff', { params });
    return response.data;
  },

  async listAudits(params: { scene?: string; role?: string; limit?: number }) {
    const response = await api.get<PromptTemplateAuditItem[]>('/prompt-registry/audits', { params });
    return response.data;
  },

  async deleteTemplate(templateId: string) {
    const response = await api.delete<{ deleted: boolean; templateId: string }>(`/prompt-registry/templates/${templateId}`);
    return response.data;
  },
};
