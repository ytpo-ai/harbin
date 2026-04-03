import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IncubationProject,
  IncubationProjectDocument,
} from '../schemas/incubation-project.schema';
import {
  CreateIncubationProjectDto,
  UpdateIncubationProjectDto,
  QueryIncubationProjectDto,
} from '../dto';

@Injectable()
export class IncubationProjectsService {
  constructor(
    @InjectModel(IncubationProject.name)
    private readonly projectModel: Model<IncubationProjectDocument>,
  ) {}

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
}
