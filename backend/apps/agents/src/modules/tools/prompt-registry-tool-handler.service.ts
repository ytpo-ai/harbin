import { Injectable } from '@nestjs/common';
import { PromptRegistryAdminService } from '../prompt-registry/prompt-registry-admin.service';

const ALLOWED_PROMPT_CATEGORIES = new Set(['system', 'recruitment']);
const RECRUITMENT_ROLE_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;
const ALLOWED_LIST_STATUSES = new Set<PromptTemplateListStatus>(['draft', 'published', 'archived', 'all']);

type PromptTemplateListStatus = 'draft' | 'published' | 'archived' | 'all';

interface PromptTemplateSourceInput {
  type?: 'github' | 'manual' | 'internal' | string;
  repo?: string;
  path?: string;
}

interface PromptTemplateInput {
  scene?: string;
  role?: string;
  content?: string;
  description?: string;
  category?: string;
  tags?: string[];
  source?: PromptTemplateSourceInput;
}

@Injectable()
export class PromptRegistryToolHandler {
  constructor(private readonly promptRegistryAdminService: PromptRegistryAdminService) {}

  async listPromptTemplates(params: {
    scene?: string;
    role?: string;
    category?: string;
    status?: PromptTemplateListStatus | string;
    limit?: number;
  }): Promise<{
    total: number;
    templates: Array<{
      _id?: string;
      scene: string;
      role: string;
      version: number;
      status: string;
      category?: string;
      description?: string;
      updatedAt?: string;
    }>;
  }> {
    const scene = String(params?.scene || '').trim();
    const rawRole = String(params?.role || '').trim();
    const category = String(params?.category || '').trim().toLowerCase();
    const statusCandidate = String(params?.status || '').trim() || 'published';
    const limit = Number(params?.limit || 50);
    const status: PromptTemplateListStatus = ALLOWED_LIST_STATUSES.has(statusCandidate as PromptTemplateListStatus)
      ? (statusCandidate as PromptTemplateListStatus)
      : 'published';

    const useRolePrefix = rawRole.endsWith(':') || rawRole.endsWith('*');
    const rolePrefix = useRolePrefix
      ? rawRole.replace(/\*$/, '')
      : '';
    const role = !useRolePrefix ? rawRole : '';

    const templates = await this.promptRegistryAdminService.listTemplates({
      scene: scene || undefined,
      role: role || undefined,
      category: category || undefined,
      status,
      limit,
    });

    const filtered = templates
      .filter((item) => {
        if (rolePrefix && !String(item.role || '').startsWith(rolePrefix)) {
          return false;
        }
        if (category && String(item.category || '').trim().toLowerCase() !== category) {
          return false;
        }
        return true;
      })
      .map((item) => ({
        _id: item._id ? String(item._id) : undefined,
        scene: String(item.scene || ''),
        role: String(item.role || ''),
        version: Number(item.version || 0),
        status: String(item.status || ''),
        category: item.category ? String(item.category) : undefined,
        description: item.description ? String(item.description) : undefined,
        updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : undefined,
      }));

    return {
      total: filtered.length,
      templates: filtered,
    };
  }

  async getPromptTemplate(params: {
    scene?: string;
    role?: string;
    templateId?: string;
  }): Promise<{
    _id?: string;
    scene: string;
    role: string;
    version?: number;
    status?: string;
    category?: string;
    description?: string;
    content: string;
    tags?: string[];
    source?: { type?: string; repo?: string; path?: string; importedAt?: string };
    updatedAt?: string;
  }> {
    const templateId = String(params?.templateId || '').trim();
    const scene = String(params?.scene || '').trim();
    const role = String(params?.role || '').trim();

    if (templateId) {
      const template = await this.promptRegistryAdminService.getTemplateById(templateId);
      return {
        _id: template._id ? String(template._id) : undefined,
        scene: String(template.scene || ''),
        role: String(template.role || ''),
        version: Number(template.version || 0) || undefined,
        status: String(template.status || ''),
        category: template.category ? String(template.category) : undefined,
        description: template.description ? String(template.description) : undefined,
        content: String(template.content || ''),
        tags: Array.isArray(template.tags) ? template.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : undefined,
        source: template.source
          ? {
              type: template.source.type ? String(template.source.type) : undefined,
              repo: template.source.repo ? String(template.source.repo) : undefined,
              path: template.source.path ? String(template.source.path) : undefined,
              importedAt: template.source.importedAt
                ? new Date(String(template.source.importedAt)).toISOString()
                : undefined,
            }
          : undefined,
        updatedAt: template.updatedAt ? new Date(template.updatedAt).toISOString() : undefined,
      };
    }

    if (!scene || !role) {
      throw new Error('get_prompt_template requires templateId or scene + role');
    }

    const effective = await this.promptRegistryAdminService.getEffectiveTemplate({ scene, role });
    if (!String(effective?.content || '').trim()) {
      throw new Error(`prompt template not found for ${scene}/${role}`);
    }

    const latest = await this.promptRegistryAdminService.listTemplates({
      scene,
      role,
      status: 'published',
      limit: 1,
    });
    const matched = latest[0];

    return {
      _id: matched?._id ? String(matched._id) : undefined,
      scene,
      role,
      version: Number(matched?.version || effective.version || 0) || undefined,
      status: matched?.status ? String(matched.status) : 'published',
      category: matched?.category ? String(matched.category) : undefined,
      description: matched?.description ? String(matched.description) : undefined,
      content: String(effective.content || ''),
      tags: Array.isArray(matched?.tags)
        ? matched.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
        : undefined,
      source: matched?.source
        ? {
            type: matched.source.type ? String(matched.source.type) : undefined,
            repo: matched.source.repo ? String(matched.source.repo) : undefined,
            path: matched.source.path ? String(matched.source.path) : undefined,
            importedAt: matched.source.importedAt ? new Date(String(matched.source.importedAt)).toISOString() : undefined,
          }
        : undefined,
      updatedAt: matched?.updatedAt
        ? new Date(matched.updatedAt).toISOString()
        : effective.updatedAt,
    };
  }

  async savePromptTemplate(params: {
    scene?: string;
    role?: string;
    content?: string;
    description?: string;
    category?: string;
    tags?: string[];
    source?: PromptTemplateSourceInput;
    templates?: PromptTemplateInput[];
    autoPublish?: boolean;
  }): Promise<any> {
    const autoPublish = params?.autoPublish === true;
    const templates = Array.isArray(params?.templates) && params.templates.length
      ? params.templates
      : [params as PromptTemplateInput];

    if (!templates.length) {
      throw new Error('save_prompt_template requires at least one template');
    }

    const details: Array<Record<string, unknown>> = [];
    let created = 0;
    let updated = 0;
    let failed = 0;

    for (const rawTemplate of templates) {
      try {
        const normalized = this.normalizeTemplate(rawTemplate);
        const draft = await this.promptRegistryAdminService.saveDraft({
          scene: normalized.scene,
          role: normalized.role,
          content: normalized.content,
          description: normalized.description,
          category: normalized.category,
          tags: normalized.tags,
          source: normalized.source,
          summary: normalized.source?.repo
            ? `Import prompt from ${normalized.source.repo}${normalized.source.path ? `:${normalized.source.path}` : ''}`
            : 'Import prompt template via MCP tool',
          operatorId: 'mcp.prompt-registry.save-template',
        });

        if (draft.version <= 1) {
          created += 1;
        } else {
          updated += 1;
        }

        if (autoPublish) {
          await this.promptRegistryAdminService.publish({
            scene: normalized.scene,
            role: normalized.role,
            version: draft.version,
            summary: `Auto publish imported draft v${draft.version}`,
            operatorId: 'mcp.prompt-registry.save-template',
          });
        }

        details.push({
          success: true,
          scene: normalized.scene,
          role: normalized.role,
          version: draft.version,
          status: autoPublish ? 'published' : 'draft',
          category: draft.category,
          tags: draft.tags || [],
          source: draft.source,
        });
      } catch (error) {
        failed += 1;
        details.push({
          success: false,
          scene: String(rawTemplate?.scene || '').trim() || undefined,
          role: String(rawTemplate?.role || '').trim() || undefined,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      success: failed === 0,
      totalProcessed: templates.length,
      created,
      updated,
      failed,
      autoPublish,
      details,
      completedAt: new Date().toISOString(),
    };
  }

  private normalizeTemplate(input: PromptTemplateInput): {
    scene: string;
    role: string;
    content: string;
    description?: string;
    category?: string;
    tags?: string[];
    source?: {
      type: 'github' | 'manual' | 'internal';
      repo?: string;
      path?: string;
      importedAt?: Date;
    };
  } {
    const scene = String(input?.scene || '').trim();
    const role = String(input?.role || '').trim();
    const content = String(input?.content || '').trim();
    const description = String(input?.description || '').trim() || undefined;
    const category = String(input?.category || '').trim().toLowerCase();
    const tags = Array.from(
      new Set(
        (Array.isArray(input?.tags) ? input.tags : [])
          .map((tag) => String(tag || '').trim())
          .filter(Boolean),
      ),
    );

    if (!scene || !role || !content || !category) {
      throw new Error('save_prompt_template requires category, scene, role and content');
    }

    if (!ALLOWED_PROMPT_CATEGORIES.has(category)) {
      throw new Error('save_prompt_template category must be system | recruitment');
    }

    if (category === 'recruitment' && !RECRUITMENT_ROLE_PATTERN.test(role)) {
      throw new Error('save_prompt_template recruitment role must match <domain>:<persona-role>');
    }

    const sourceType = String(input?.source?.type || '').trim().toLowerCase();
    const source = sourceType
      ? {
          type: this.normalizeSourceType(sourceType),
          repo: String(input?.source?.repo || '').trim() || undefined,
          path: String(input?.source?.path || '').trim() || undefined,
          importedAt: new Date(),
        }
      : undefined;

    return {
      scene,
      role,
      content,
      description,
      category,
      tags: tags.length ? tags : undefined,
      source,
    };
  }

  private normalizeSourceType(sourceType: string): 'github' | 'manual' | 'internal' {
    if (sourceType === 'github' || sourceType === 'manual' || sourceType === 'internal') {
      return sourceType;
    }
    throw new Error('save_prompt_template source.type must be github | manual | internal');
  }
}
