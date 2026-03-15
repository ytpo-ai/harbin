import { Injectable } from '@nestjs/common';
import { EngineeringIntelligence } from './ei.service';
import {
  AddRequirementCommentDto,
  AssignRequirementDto,
  CreateRequirementDto,
  ListRequirementsDto,
  SyncRequirementToGithubDto,
  UpdateRequirementStatusDto,
} from '../dto';

@Injectable()
export class EiRequirementsService {
  constructor(private readonly core: EngineeringIntelligence) {}

  createRequirement(payload: CreateRequirementDto) {
    return this.core.createRequirement(payload);
  }

  listRequirements(query: ListRequirementsDto) {
    return this.core.listRequirements(query);
  }

  getRequirementBoard() {
    return this.core.getRequirementBoard();
  }

  getRequirementById(requirementId: string) {
    return this.core.getRequirementById(requirementId);
  }

  deleteRequirement(requirementId: string) {
    return this.core.deleteRequirement(requirementId);
  }

  addRequirementComment(requirementId: string, payload: AddRequirementCommentDto) {
    return this.core.addRequirementComment(requirementId, payload);
  }

  assignRequirement(requirementId: string, payload: AssignRequirementDto) {
    return this.core.assignRequirement(requirementId, payload);
  }

  updateRequirementStatus(requirementId: string, payload: UpdateRequirementStatusDto) {
    return this.core.updateRequirementStatus(requirementId, payload);
  }

  syncRequirementToGithub(requirementId: string, payload: SyncRequirementToGithubDto) {
    return this.core.syncRequirementToGithub(requirementId, payload);
  }
}
