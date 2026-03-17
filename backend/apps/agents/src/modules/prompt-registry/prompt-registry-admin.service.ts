import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PromptTemplate,
  PromptTemplateDocument,
  PromptTemplateStatus,
} from '../../../../../src/shared/schemas/prompt-template.schema';
import {
  PromptTemplateAudit,
  PromptTemplateAuditDocument,
} from '../../../../../src/shared/schemas/prompt-template-audit.schema';
import { PromptResolverService } from '../../../../../src/modules/prompt-registry/prompt-resolver.service';

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

  async saveDraft(input: {
    scene: string;
    role: string;
    content: string;
    baseVersion?: number;
    summary?: string;
    operatorId?: string;
  }) {
    const normalized = this.normalizeSceneRoleContent(input.scene, input.role, input.content);
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

    await this.promptResolverService.refreshPublishedCache(scene, role);
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
      updatedBy: String(input.operatorId || '').trim() || undefined,
      updatedAt: new Date(),
    });

    await this.promptResolverService.refreshPublishedCache(scene, role);
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

  private normalizeSceneRoleContent(scene: string, role: string, content: string) {
    const normalizedScene = String(scene || '').trim();
    const normalizedRole = String(role || '').trim();
    const normalizedContent = String(content || '').trim();
    if (!normalizedScene || !normalizedRole || !normalizedContent) {
      throw new BadRequestException('scene, role, content are required');
    }
    return { scene: normalizedScene, role: normalizedRole, content: normalizedContent };
  }

  private async getLatestVersion(scene: string, role: string): Promise<PromptTemplateDocument | null> {
    return this.promptTemplateModel.findOne({ scene, role }).sort({ version: -1 }).exec();
  }

  private async createAudit(input: {
    scene: string;
    role: string;
    action: 'create_draft' | 'publish' | 'rollback';
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
