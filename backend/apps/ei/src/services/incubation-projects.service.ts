import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { access, copyFile, mkdir, readdir } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { resolve, join } from 'path';
import {
  IncubationProject,
  IncubationProjectDocument,
} from '../schemas/incubation-project.schema';
import { RdProject, RdProjectDocument, RdProjectSourceType } from '../../../../src/shared/schemas/ei-project.schema';
import {
  CreateIncubationProjectDto,
  UpdateIncubationProjectDto,
  QueryIncubationProjectDto,
} from '../dto';

type TemplateCopyStats = {
  copiedFiles: number;
  skippedExistingFiles: number;
  createdDirectories: number;
};

@Injectable()
export class IncubationProjectsService {
  constructor(
    @InjectModel(IncubationProject.name)
    private readonly projectModel: Model<IncubationProjectDocument>,
    @InjectModel(RdProject.name)
    private readonly rdProjectModel: Model<RdProjectDocument>,
  ) {}

  private async getTemplateDirectory(): Promise<string> {
    const candidates = [
      resolve(process.cwd(), 'data/template'),
      resolve(process.cwd(), '../data/template'),
    ];

    for (const candidate of candidates) {
      try {
        await access(candidate, fsConstants.R_OK);
        return candidate;
      } catch {
        continue;
      }
    }

    return candidates[0];
  }

  private async assertReadableDirectory(path: string, label: string): Promise<void> {
    try {
      await access(path, fsConstants.R_OK);
    } catch {
      throw new BadRequestException(`${label} 不存在或无读取权限: ${path}`);
    }
  }

  private async assertWritableDirectory(path: string, label: string): Promise<void> {
    try {
      await access(path, fsConstants.W_OK);
    } catch {
      throw new BadRequestException(`${label} 不存在或无写入权限: ${path}`);
    }
  }

  private async copyTemplateDirectory(sourceDir: string, targetDir: string): Promise<TemplateCopyStats> {
    const stats: TemplateCopyStats = {
      copiedFiles: 0,
      skippedExistingFiles: 0,
      createdDirectories: 0,
    };

    const ensureDirectory = async (dirPath: string) => {
      try {
        await access(dirPath, fsConstants.F_OK);
      } catch {
        await mkdir(dirPath, { recursive: true });
        stats.createdDirectories += 1;
      }
    };

    const walk = async (src: string, dst: string) => {
      await ensureDirectory(dst);
      const entries = await readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const sourcePath = join(src, entry.name);
        const targetPath = join(dst, entry.name);

        if (entry.isDirectory()) {
          await walk(sourcePath, targetPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        try {
          await access(targetPath, fsConstants.F_OK);
          stats.skippedExistingFiles += 1;
        } catch {
          await copyFile(sourcePath, targetPath);
          stats.copiedFiles += 1;
        }
      }
    };

    await walk(sourceDir, targetDir);
    return stats;
  }

  async create(dto: CreateIncubationProjectDto, createdBy?: string): Promise<IncubationProjectDocument> {
    const project = new this.projectModel({
      ...dto,
      createdBy,
    });
    return project.save();
  }

  async findAll(query: QueryIncubationProjectDto): Promise<IncubationProjectDocument[]> {
    const filter: Record<string, any> = {};
    if (query.status) {
      filter.status = query.status;
    }
    return this.projectModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<IncubationProjectDocument> {
    const project = await this.projectModel.findById(id).exec();
    if (!project) {
      throw new NotFoundException(`孵化项目 ${id} 不存在`);
    }
    return project;
  }

  async update(id: string, dto: UpdateIncubationProjectDto): Promise<IncubationProjectDocument> {
    const project = await this.projectModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true })
      .exec();
    if (!project) {
      throw new NotFoundException(`孵化项目 ${id} 不存在`);
    }
    return project;
  }

  async delete(id: string): Promise<void> {
    const result = await this.projectModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`孵化项目 ${id} 不存在`);
    }
  }

  async initializeTemplate(id: string): Promise<{
    projectId: string;
    isTemplateInitialized: boolean;
    localProjectId: string;
    localPath: string;
    copiedFiles: number;
    skippedExistingFiles: number;
    createdDirectories: number;
  }> {
    const project = await this.findById(id);
    if (project.isTemplateInitialized) {
      throw new BadRequestException('该孵化项目已完成模板初始化');
    }

    const localProjects = await this.rdProjectModel
      .find({
        sourceType: RdProjectSourceType.LOCAL,
        incubationProjectId: project._id,
      })
      .sort({ updatedAt: -1 })
      .select('_id localPath')
      .lean()
      .exec();

    if (localProjects.length === 0) {
      throw new BadRequestException('该孵化项目尚未绑定本地项目，无法初始化模板');
    }

    if (localProjects.length > 1) {
      throw new BadRequestException('该孵化项目绑定了多个本地项目，请先保持单绑定后再初始化模板');
    }

    const localProject = localProjects[0] as { _id: unknown; localPath?: string };
    const localPath = String(localProject.localPath || '').trim();
    if (!localPath) {
      throw new BadRequestException('绑定的本地项目缺少 localPath，无法初始化模板');
    }

    const templateDirectory = await this.getTemplateDirectory();
    await this.assertReadableDirectory(templateDirectory, '模板目录');
    await this.assertWritableDirectory(localPath, '目标项目目录');

    const stats = await this.copyTemplateDirectory(templateDirectory, localPath);

    await this.projectModel
      .findByIdAndUpdate(project._id, { $set: { isTemplateInitialized: true } }, { new: false })
      .exec();

    return {
      projectId: String(project._id),
      isTemplateInitialized: true,
      localProjectId: String(localProject._id),
      localPath,
      copiedFiles: stats.copiedFiles,
      skippedExistingFiles: stats.skippedExistingFiles,
      createdDirectories: stats.createdDirectories,
    };
  }
}
