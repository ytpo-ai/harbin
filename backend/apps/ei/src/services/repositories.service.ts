import { Injectable } from '@nestjs/common';
import { EngineeringIntelligence } from './ei.service';
import { CreateEngineeringRepositoryDto, UpdateEngineeringRepositoryDto } from '../dto';

@Injectable()
export class EiRepositoriesService {
  constructor(private readonly core: EngineeringIntelligence) {}

  createRepository(dto: CreateEngineeringRepositoryDto) {
    return this.core.createRepository(dto);
  }

  listRepositories() {
    return this.core.listRepositories();
  }

  updateRepository(id: string, dto: UpdateEngineeringRepositoryDto) {
    return this.core.updateRepository(id, dto);
  }

  deleteRepository(id: string) {
    return this.core.deleteRepository(id);
  }

  summarizeRepository(id: string) {
    return this.core.summarizeRepository(id);
  }

  getRepositoryDocsTree(id: string) {
    return this.core.getRepositoryDocsTree(id);
  }

  getRepositoryDocContent(id: string, docPath: string) {
    return this.core.getRepositoryDocContent(id, docPath);
  }

  getRepositoryDocHistory(id: string, docPath: string, limit?: number) {
    return this.core.getRepositoryDocHistory(id, docPath, limit);
  }
}
