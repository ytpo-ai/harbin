import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import {
  ApplyOutlineTemplateDto,
  CreateOutlineTemplateDto,
  QueryOutlineTemplatesDto,
  UpdateOutlineTemplateDto,
} from '../dto';
import {
  EiOutlineTemplate,
  EiOutlineTemplateDocument,
  EiOutlineTemplateType,
} from '../schemas/ei-outline-template.schema';
import { unwrapResponseEnvelope } from '../../../../src/shared/common/utils/unwrap-response-envelope';

type OutlineSectionPayload = {
  id: string;
  title: string;
  description?: string;
  parentSectionId?: string;
  order: number;
  depth: number;
  status: 'draft' | 'enriching' | 'sufficient' | 'review';
  knowledgeCount: number;
  childSectionIds: string[];
  metadata?: {
    suggestedDataSources?: string[];
    collectFrequency?: string;
    isStructuredData?: boolean;
  };
};

@Injectable()
export class EiOutlineTemplatesService {
  private readonly legacyBaseUrl = String(process.env.LEGACY_SERVICE_URL || 'http://localhost:3001').trim().replace(/\/+$/, '');
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly timeout = Number(process.env.LEGACY_SERVICE_TIMEOUT_MS || 20000);

  constructor(
    @InjectModel(EiOutlineTemplate.name)
    private readonly outlineTemplateModel: Model<EiOutlineTemplateDocument>,
  ) {}

  private buildSignedHeaders(): Record<string, string> {
    const now = Date.now();
    const context: GatewayUserContext = {
      employeeId: 'ei-service',
      role: 'system',
      issuedAt: now,
      expiresAt: now + 60 * 1000,
    };
    const encoded = encodeUserContext(context);
    const signature = signEncodedContext(encoded, this.contextSecret);
    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
      'content-type': 'application/json',
    };
  }

  private defaultSections(templateType: EiOutlineTemplateType) {
    if (templateType !== 'industry_observation') {
      return [];
    }

    return [
      { key: 'timeline', title: '行业发展脉络', order: 0, depth: 0 },
      { key: 'top_companies', title: 'TOP 公司图谱', order: 1, depth: 0, metadata: { isStructuredData: true, collectFrequency: 'weekly' } },
      { key: 'key_people', title: '关键人物与组织', order: 2, depth: 0 },
      { key: 'trend_narrative', title: '趋势与叙事', order: 3, depth: 0 },
      { key: 'metrics', title: '关键指标追踪', order: 4, depth: 0, metadata: { isStructuredData: true, collectFrequency: 'daily' } },
      { key: 'actions', title: '待开发数据采集任务', order: 5, depth: 0, metadata: { isStructuredData: true, collectFrequency: 'weekly' } },
    ];
  }

  private async ensureSystemTemplate(templateType: EiOutlineTemplateType): Promise<void> {
    if (templateType !== 'industry_observation') {
      return;
    }

    const existed = await this.outlineTemplateModel.exists({
      isSystem: true,
      templateType,
      name: '行业观察通用模板',
    });
    if (existed) {
      return;
    }

    await this.outlineTemplateModel.create({
      name: '行业观察通用模板',
      description: '适用于区块链、能源、AI 等行业观察场景的系统默认大纲模板',
      templateType,
      applicableIndustries: [],
      sections: this.defaultSections(templateType),
      suggestedDataSources: [],
      isSystem: true,
      createdBy: 'system',
    });
  }

  private buildOutlineSectionsFromTemplate(template: EiOutlineTemplate): OutlineSectionPayload[] {
    const sourceSections = (template.sections || []).map((item, index) => ({
      key: String(item?.key || `section_${index + 1}`).trim(),
      title: String(item?.title || `章节 ${index + 1}`).trim(),
      description: item?.description,
      parentSectionKey: item?.parentSectionKey,
      order: Number.isFinite(item?.order) ? Number(item.order) : index,
      depth: Number.isFinite(item?.depth) ? Number(item.depth) : 0,
      metadata: item?.metadata,
    }));

    const keyToId = new Map<string, string>();
    sourceSections.forEach((item) => {
      keyToId.set(item.key, randomUUID());
    });

    const sections: OutlineSectionPayload[] = sourceSections.map((item) => {
      const parentSectionId = item.parentSectionKey ? keyToId.get(item.parentSectionKey) : undefined;
      return {
        id: keyToId.get(item.key) || randomUUID(),
        title: item.title,
        description: item.description,
        parentSectionId,
        order: item.order,
        depth: item.depth,
        status: 'draft',
        knowledgeCount: 0,
        childSectionIds: [],
        metadata: item.metadata,
      };
    });

    const childrenMap = new Map<string, string[]>();
    sections.forEach((section) => {
      if (!section.parentSectionId) {
        return;
      }
      const children = childrenMap.get(section.parentSectionId) || [];
      children.push(section.id);
      childrenMap.set(section.parentSectionId, children);
    });

    return sections.map((section) => ({
      ...section,
      childSectionIds: childrenMap.get(section.id) || [],
    }));
  }

  async list(query: QueryOutlineTemplatesDto): Promise<EiOutlineTemplate[]> {
    if (query.type) {
      await this.ensureSystemTemplate(query.type as EiOutlineTemplateType);
    }

    const filter: Record<string, unknown> = {};
    if (query.type) {
      filter.templateType = query.type;
    }

    const list = await this.outlineTemplateModel.find(filter).sort({ isSystem: -1, updatedAt: -1 }).lean().exec();

    const industry = String(query.industry || '').trim().toLowerCase();
    if (!industry) {
      return list as unknown as EiOutlineTemplate[];
    }

    return (list as unknown as EiOutlineTemplate[]).filter((item) => {
      if (!Array.isArray(item.applicableIndustries) || item.applicableIndustries.length === 0) {
        return true;
      }
      return item.applicableIndustries.some((current) => String(current || '').trim().toLowerCase() === industry);
    });
  }

  async getById(id: string): Promise<EiOutlineTemplate> {
    const item = await this.outlineTemplateModel.findById(id).lean().exec();
    if (!item) {
      throw new NotFoundException(`大纲模板 ${id} 不存在`);
    }
    return item as unknown as EiOutlineTemplate;
  }

  async create(payload: CreateOutlineTemplateDto): Promise<EiOutlineTemplate> {
    const created = await this.outlineTemplateModel.create({
      ...payload,
      description: payload.description || '',
      applicableIndustries: payload.applicableIndustries || [],
      suggestedDataSources: payload.suggestedDataSources || [],
      sections: (payload.sections || []).map((item, index) => ({
        ...item,
        key: String(item.key || `section_${index + 1}`).trim(),
        order: Number.isFinite(item.order) ? Number(item.order) : index,
        depth: Number.isFinite(item.depth) ? Number(item.depth) : 0,
      })),
      isSystem: Boolean(payload.isSystem),
    });
    return created as unknown as EiOutlineTemplate;
  }

  async update(id: string, payload: UpdateOutlineTemplateDto): Promise<EiOutlineTemplate> {
    const updated = await this.outlineTemplateModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            ...payload,
            sections: payload.sections
              ? payload.sections.map((item, index) => ({
                  ...item,
                  key: String(item.key || `section_${index + 1}`).trim(),
                  order: Number.isFinite(item.order) ? Number(item.order) : index,
                  depth: Number.isFinite(item.depth) ? Number(item.depth) : 0,
                }))
              : undefined,
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(`大纲模板 ${id} 不存在`);
    }

    return updated as unknown as EiOutlineTemplate;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.outlineTemplateModel.findByIdAndDelete(id).lean().exec();
    if (!deleted) {
      throw new NotFoundException(`大纲模板 ${id} 不存在`);
    }
    return { deleted: true };
  }

  async apply(id: string, payload: ApplyOutlineTemplateDto): Promise<{ applied: true; spaceId: string; templateId: string }> {
    const template = await this.getById(id);
    const sections = this.buildOutlineSectionsFromTemplate(template);
    const outlineTitle = String(payload.outlineTitle || '').trim() || `${template.name} - ${payload.spaceId}`;

    const response = await axios.put(
      `${this.legacyBaseUrl}/api/discussions/${encodeURIComponent(payload.spaceId)}/outline`,
      {
        title: outlineTitle,
        sections,
        generatedBy: 'human',
      },
      {
        headers: this.buildSignedHeaders(),
        timeout: this.timeout,
      },
    );
    unwrapResponseEnvelope(response.data);
    return {
      applied: true,
      spaceId: payload.spaceId,
      templateId: id,
    };
  }
}
