import { Injectable } from '@nestjs/common';
import { PromptRegistryAdminService } from '../prompt-registry/prompt-registry-admin.service';

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
    };
  } {
    const scene = String(input?.scene || '').trim();
    const role = String(input?.role || '').trim();
    const content = String(input?.content || '').trim();
    const description = String(input?.description || '').trim() || undefined;
    const category = String(input?.category || '').trim() || undefined;
    const tags = Array.from(
      new Set(
        (Array.isArray(input?.tags) ? input.tags : [])
          .map((tag) => String(tag || '').trim())
          .filter(Boolean),
      ),
    );

    if (!scene || !role || !content) {
      throw new Error('save_prompt_template requires scene, role and content');
    }

    const sourceType = String(input?.source?.type || '').trim().toLowerCase();
    const source = sourceType
      ? {
          type: this.normalizeSourceType(sourceType),
          repo: String(input?.source?.repo || '').trim() || undefined,
          path: String(input?.source?.path || '').trim() || undefined,
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
