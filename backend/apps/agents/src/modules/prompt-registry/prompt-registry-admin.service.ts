import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PromptTemplate,
  PromptTemplateDocument,
  PromptTemplateStatus,
} from '../../schemas/prompt-template.schema';
import {
  PromptTemplateAudit,
  PromptTemplateAuditDocument,
} from '../../schemas/prompt-template-audit.schema';
import { PromptResolverService } from './prompt-resolver.service';

@Injectable()
export class PromptRegistryAdminService {
  constructor(
    @InjectModel(PromptTemplate.name)
    private readonly promptTemplateModel: Model<PromptTemplateDocument>,
    @InjectModel(PromptTemplateAudit.name)
    private readonly promptTemplateAuditModel: Model<PromptTemplateAuditDocument>,
    private readonly promptResolverService: PromptResolverService,
  ) {}

  async listTemplates(query: {
    scene?: string;
    role?: string;
    status?: PromptTemplateStatus | 'all';
    limit?: number;
  }) {
    const filter: Record<string, unknown> = {};
    const scene = String(query.scene || '').trim();
    const role = String(query.role || '').trim();
    const status = String(query.status || '').trim();
    const limit = Math.min(200, Math.max(1, Number(query.limit || 50)));

    if (scene) filter.scene = scene;
    if (role) filter.role = role;
    if (status && status !== 'all') {
      filter.status = status;
    }

    return this.promptTemplateModel
      .find(filter)
      .sort({ scene: 1, role: 1, version: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async listTemplateFilters() {
    const [sceneRolePairs, statuses] = await Promise.all([
      this.promptTemplateModel
        .aggregate<{ _id: { scene: string; role: string } }>([
          {
            $match: {
              scene: { $type: 'string', $nin: ['', null] },
              role: { $type: 'string', $nin: ['', null] },
            },
          },
          {
            $group: {
              _id: {
                scene: '$scene',
                role: '$role',
              },
            },
          },
          {
            $sort: {
              '_id.scene': 1,
              '_id.role': 1,
            },
          },
        ])
        .exec(),
      this.promptTemplateModel.distinct('status', { status: { $type: 'string', $nin: ['', null] } }).exec(),
    ]);

    const sceneRoleMap: Record<string, string[]> = {};
    for (const pair of sceneRolePairs) {
      const scene = String(pair?._id?.scene || '').trim();
      const role = String(pair?._id?.role || '').trim();
      if (!scene || !role) {
        continue;
      }
      if (!sceneRoleMap[scene]) {
        sceneRoleMap[scene] = [];
      }
      if (!sceneRoleMap[scene].includes(role)) {
        sceneRoleMap[scene].push(role);
      }
    }

    const scenes = Object.keys(sceneRoleMap).sort((a, b) => a.localeCompare(b));
    for (const scene of scenes) {
      sceneRoleMap[scene] = sceneRoleMap[scene].sort((a, b) => a.localeCompare(b));
    }

    const roles = Array.from(
      new Set(
        Object.values(sceneRoleMap)
          .flat()
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));

    const normalizedStatuses = Array.from(
      new Set(statuses.map((item) => String(item || '').trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));

    return {
      scenes,
      roles,
      statuses: normalizedStatuses,
      sceneRoleMap,
    };
  }

  async getEffectiveTemplate(input: { scene: string; role: string; sessionOverride?: string }) {
    const scene = String(input.scene || '').trim();
    const role = String(input.role || '').trim();
    if (!scene || !role) {
      throw new BadRequestException('scene and role are required');
    }
    return this.promptResolverService.resolve({
      scene,
      role,
      defaultContent: '',
      sessionOverride: input.sessionOverride,
    });
  }

  async getTemplateById(templateId: string) {
    const normalizedId = String(templateId || '').trim();
    if (!normalizedId) {
      throw new BadRequestException('templateId is required');
    }

    const template = await this.promptTemplateModel.findById(normalizedId).lean().exec();
    if (!template) {
      throw new NotFoundException('template not found');
    }
    return template;
  }

  async saveDraft(input: {
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
    baseVersion?: number;
    summary?: string;
    operatorId?: string;
  }) {
    const normalized = this.normalizeDraftInput({
      scene: input.scene,
      role: input.role,
      content: input.content,
      description: input.description,
      category: input.category,
      tags: input.tags,
      source: input.source,
    });
    const latest = await this.getLatestVersion(normalized.scene, normalized.role);
    const nextVersion = (latest?.version || 0) + 1;
    const summary = String(input.summary || '').trim();

    if (typeof input.baseVersion === 'number' && input.baseVersion > 0) {
      const existingBase = await this.promptTemplateModel
        .findOne({ scene: normalized.scene, role: normalized.role, version: input.baseVersion })
        .lean()
        .exec();
      if (!existingBase) {
        throw new BadRequestException(`baseVersion ${input.baseVersion} not found`);
      }
    }

    const created = await this.promptTemplateModel.create({
      scene: normalized.scene,
      role: normalized.role,
      version: nextVersion,
      status: 'draft',
      content: normalized.content,
      description: normalized.description,
      category: normalized.category,
      tags: normalized.tags,
      source: normalized.source,
      updatedBy: String(input.operatorId || '').trim() || undefined,
      updatedAt: new Date(),
    });

    await this.createAudit({
      scene: normalized.scene,
      role: normalized.role,
      action: 'create_draft',
      version: nextVersion,
      fromVersion: input.baseVersion,
      operatorId: input.operatorId,
      summary: summary || `创建草稿 v${nextVersion}`,
    });

    return created;
  }

  async publish(input: { scene: string; role: string; version: number; summary?: string; operatorId?: string }) {
    const scene = String(input.scene || '').trim();
    const role = String(input.role || '').trim();
    const version = Number(input.version || 0);
    if (!scene || !role || !version) {
      throw new BadRequestException('scene, role, version are required');
    }

    const target = await this.promptTemplateModel.findOne({ scene, role, version }).exec();
    if (!target) {
      throw new NotFoundException(`template version not found: ${version}`);
    }

    await this.promptTemplateModel
      .updateMany({ scene, role, status: 'published', version: { $ne: version } }, { $set: { status: 'archived' } })
      .exec();

    target.status = 'published';
    target.updatedBy = String(input.operatorId || '').trim() || target.updatedBy;
    target.updatedAt = new Date();
    await target.save();

    await this.promptResolverService.cachePublishedTemplate({
      scene,
      role,
      content: target.content,
      version,
      updatedAt: target.updatedAt,
    });
    await this.createAudit({
      scene,
      role,
      action: 'publish',
      version,
      operatorId: input.operatorId,
      summary: String(input.summary || '').trim() || `发布模板 v${version}`,
    });

    return target;
  }

  async unpublish(input: { scene: string; role: string; version: number; summary?: string; operatorId?: string }) {
    const scene = String(input.scene || '').trim();
    const role = String(input.role || '').trim();
    const version = Number(input.version || 0);
    if (!scene || !role || !version) {
      throw new BadRequestException('scene, role, version are required');
    }

    const target = await this.promptTemplateModel.findOne({ scene, role, version }).exec();
    if (!target) {
      throw new NotFoundException(`template version not found: ${version}`);
    }
    if (target.status !== 'published') {
      throw new BadRequestException('only published template can be unpublished');
    }

    target.status = 'archived';
    target.updatedBy = String(input.operatorId || '').trim() || target.updatedBy;
    target.updatedAt = new Date();
    await target.save();

    await this.promptResolverService.clearPublishedCache(scene, role);
    await this.createAudit({
      scene,
      role,
      action: 'unpublish',
      version,
      operatorId: input.operatorId,
      summary: String(input.summary || '').trim() || `取消发布模板 v${version}`,
    });

    return target;
  }

  async rollback(input: { scene: string; role: string; targetVersion: number; summary?: string; operatorId?: string }) {
    const scene = String(input.scene || '').trim();
    const role = String(input.role || '').trim();
    const targetVersion = Number(input.targetVersion || 0);
    if (!scene || !role || !targetVersion) {
      throw new BadRequestException('scene, role, targetVersion are required');
    }

    const target = await this.promptTemplateModel.findOne({ scene, role, version: targetVersion }).lean().exec();
    if (!target) {
      throw new NotFoundException(`target version not found: ${targetVersion}`);
    }

    const latest = await this.getLatestVersion(scene, role);
    const nextVersion = (latest?.version || targetVersion) + 1;

    await this.promptTemplateModel.updateMany({ scene, role, status: 'published' }, { $set: { status: 'archived' } }).exec();

    const created = await this.promptTemplateModel.create({
      scene,
      role,
      version: nextVersion,
      status: 'published',
      content: target.content,
      description: target.description,
      category: target.category,
      tags: target.tags,
      source: target.source,
      updatedBy: String(input.operatorId || '').trim() || undefined,
      updatedAt: new Date(),
    });

    await this.promptResolverService.cachePublishedTemplate({
      scene,
      role,
      content: created.content,
      version: nextVersion,
      updatedAt: created.updatedAt,
    });
    await this.createAudit({
      scene,
      role,
      action: 'rollback',
      version: nextVersion,
      fromVersion: targetVersion,
      operatorId: input.operatorId,
      summary: String(input.summary || '').trim() || `回滚到 v${targetVersion} 并发布为 v${nextVersion}`,
    });

    return created;
  }

  async compareVersions(input: {
    scene: string;
    role: string;
    baseVersion: number;
    targetVersion: number;
  }) {
    const scene = String(input.scene || '').trim();
    const role = String(input.role || '').trim();
    const baseVersion = Number(input.baseVersion || 0);
    const targetVersion = Number(input.targetVersion || 0);
    if (!scene || !role || !baseVersion || !targetVersion) {
      throw new BadRequestException('scene, role, baseVersion, targetVersion are required');
    }

    const [base, target] = await Promise.all([
      this.promptTemplateModel.findOne({ scene, role, version: baseVersion }).lean().exec(),
      this.promptTemplateModel.findOne({ scene, role, version: targetVersion }).lean().exec(),
    ]);
    if (!base || !target) {
      throw new NotFoundException('baseVersion or targetVersion not found');
    }

    const baseLines = String(base.content || '').split('\n');
    const targetLines = String(target.content || '').split('\n');
    const baseSet = new Set(baseLines);
    const targetSet = new Set(targetLines);
    const added = targetLines.filter((line) => !baseSet.has(line));
    const removed = baseLines.filter((line) => !targetSet.has(line));

    return {
      scene,
      role,
      baseVersion,
      targetVersion,
      summary: {
        addedLines: added.length,
        removedLines: removed.length,
      },
      preview: {
        added: added.slice(0, 20),
        removed: removed.slice(0, 20),
      },
      base: {
        version: base.version,
        status: base.status,
        updatedAt: base.updatedAt,
      },
      target: {
        version: target.version,
        status: target.status,
        updatedAt: target.updatedAt,
      },
    };
  }

  async listAudits(input: { scene?: string; role?: string; limit?: number }) {
    const filter: Record<string, unknown> = {};
    const scene = String(input.scene || '').trim();
    const role = String(input.role || '').trim();
    const limit = Math.min(200, Math.max(1, Number(input.limit || 50)));
    if (scene) filter.scene = scene;
    if (role) filter.role = role;
    return this.promptTemplateAuditModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean().exec();
  }

  async deleteTemplate(input: { templateId: string }) {
    const templateId = String(input.templateId || '').trim();
    if (!templateId) {
      throw new BadRequestException('templateId is required');
    }

    const target = await this.promptTemplateModel.findById(templateId).exec();
    if (!target) {
      throw new NotFoundException('template not found');
    }

    if (target.status === 'published') {
      throw new BadRequestException('published template cannot be deleted');
    }

    await this.promptTemplateModel.deleteOne({ _id: target._id }).exec();

    return {
      deleted: true,
      templateId,
      scene: target.scene,
      role: target.role,
      version: target.version,
      status: target.status,
    };
  }

  private normalizeDraftInput(input: {
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
  }) {
    const normalizedScene = String(input.scene || '').trim();
    const normalizedRole = String(input.role || '').trim();
    const normalizedContent = String(input.content || '').trim();
    const normalizedDescription = String(input.description || '').trim();
    const normalizedCategory = String(input.category || '').trim();
    const normalizedTags = Array.from(
      new Set(
        (Array.isArray(input.tags) ? input.tags : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );
    if (!normalizedScene || !normalizedRole || !normalizedContent) {
      throw new BadRequestException('scene, role, content are required');
    }

    let normalizedSource:
      | {
          type: 'github' | 'manual' | 'internal';
          repo?: string;
          path?: string;
          importedAt: Date;
        }
      | undefined;
    if (input.source) {
      const sourceType = String(input.source.type || '').trim() as 'github' | 'manual' | 'internal';
      if (!sourceType || !['github', 'manual', 'internal'].includes(sourceType)) {
        throw new BadRequestException('source.type must be github | manual | internal');
      }
      normalizedSource = {
        type: sourceType,
        repo: String(input.source.repo || '').trim() || undefined,
        path: String(input.source.path || '').trim() || undefined,
        importedAt: input.source.importedAt instanceof Date ? input.source.importedAt : new Date(),
      };
    }

    return {
      scene: normalizedScene,
      role: normalizedRole,
      content: normalizedContent,
      description: normalizedDescription || undefined,
      category: normalizedCategory || undefined,
      tags: normalizedTags.length ? normalizedTags : undefined,
      source: normalizedSource,
    };
  }

  private async getLatestVersion(scene: string, role: string): Promise<PromptTemplateDocument | null> {
    return this.promptTemplateModel.findOne({ scene, role }).sort({ version: -1 }).exec();
  }

  private async createAudit(input: {
    scene: string;
    role: string;
    action: 'create_draft' | 'publish' | 'unpublish' | 'rollback';
    version: number;
    fromVersion?: number;
    operatorId?: string;
    summary?: string;
  }) {
    await this.promptTemplateAuditModel.create({
      scene: input.scene,
      role: input.role,
      action: input.action,
      version: input.version,
      fromVersion: input.fromVersion,
      operatorId: String(input.operatorId || '').trim() || undefined,
      summary: String(input.summary || '').trim() || undefined,
      createdAt: new Date(),
    });
  }
}
