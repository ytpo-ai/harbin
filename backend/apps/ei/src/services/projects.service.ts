import { Injectable } from '@nestjs/common';
import {
  BindGithubProjectDto,
  BindIncubationProjectDto,
  BindOpencodeProjectDto,
  CreateLocalRdProjectDto,
  CreateRdProjectDto,
  ImportOpencodeProjectDto,
  QueryRdProjectDto,
  SyncAgentOpencodeProjectsDto,
  SyncOpencodeContextDto,
  UnbindOpencodeProjectDto,
  UpdateRdProjectDto,
} from '../dto';
import { EiManagementService } from './management.service';

@Injectable()
export class EiProjectsService {
  constructor(private readonly core: EiManagementService) {}

  createProject(payload: CreateRdProjectDto) {
    return this.core.createProject(payload);
  }

  createLocalProject(payload: CreateLocalRdProjectDto) {
    return this.core.createLocalProject(payload);
  }

  findAllProjects(query: QueryRdProjectDto) {
    return this.core.findAllProjects(query);
  }

  findProjectById(projectId: string) {
    return this.core.findProjectById(projectId);
  }

  updateProject(projectId: string, payload: UpdateRdProjectDto) {
    return this.core.updateProject(projectId, payload);
  }

  deleteProject(projectId: string) {
    return this.core.deleteProject(projectId);
  }

  bindOpencodeProject(payload: BindOpencodeProjectDto) {
    return this.core.bindOpencodeProject(payload);
  }

  bindGithubProject(payload: BindGithubProjectDto) {
    return this.core.bindGithubProject(payload);
  }

  unbindOpencodeProject(localProjectId: string, payload: UnbindOpencodeProjectDto) {
    return this.core.unbindOpencodeProject(localProjectId, payload);
  }

  unbindGithubProject(localProjectId: string) {
    return this.core.unbindGithubProject(localProjectId);
  }

  bindIncubationProject(localProjectId: string, payload: BindIncubationProjectDto) {
    return this.core.bindIncubationProject(localProjectId, payload);
  }

  importOpencodeProject(payload: ImportOpencodeProjectDto) {
    return this.core.importOpencodeProject(payload);
  }

  syncAgentOpencodeProjects(agentId: string, payload: SyncAgentOpencodeProjectsDto) {
    return this.core.syncAgentOpencodeProjects(agentId, payload);
  }

  syncCurrentOpencodeToProject(projectId: string, payload: SyncOpencodeContextDto) {
    return this.core.syncOpencodeToProject(projectId, payload || {});
  }
}
