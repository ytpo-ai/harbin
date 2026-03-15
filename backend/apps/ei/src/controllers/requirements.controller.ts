import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  AddRequirementCommentDto,
  AssignRequirementDto,
  CreateRequirementDto,
  ListRequirementsDto,
  SyncRequirementToGithubDto,
  UpdateRequirementStatusDto,
} from '../dto';
import { EiRequirementsService } from '../services/requirements.service';

@Controller('ei/requirements')
export class EiRequirementsController {
  constructor(private readonly requirementsService: EiRequirementsService) {}

  @Post()
  createRequirement(@Body() payload: CreateRequirementDto) {
    return this.requirementsService.createRequirement(payload);
  }

  @Get()
  listRequirements(@Query() query: ListRequirementsDto) {
    return this.requirementsService.listRequirements(query);
  }

  @Get('board')
  getRequirementBoard() {
    return this.requirementsService.getRequirementBoard();
  }

  @Get(':requirementId')
  getRequirementById(@Param('requirementId') requirementId: string) {
    return this.requirementsService.getRequirementById(requirementId);
  }

  @Delete(':requirementId')
  deleteRequirement(@Param('requirementId') requirementId: string) {
    return this.requirementsService.deleteRequirement(requirementId);
  }

  @Post(':requirementId/comments')
  addRequirementComment(@Param('requirementId') requirementId: string, @Body() payload: AddRequirementCommentDto) {
    return this.requirementsService.addRequirementComment(requirementId, payload);
  }

  @Post(':requirementId/assign')
  assignRequirement(@Param('requirementId') requirementId: string, @Body() payload: AssignRequirementDto) {
    return this.requirementsService.assignRequirement(requirementId, payload);
  }

  @Patch(':requirementId/status')
  updateRequirementStatusPatch(
    @Param('requirementId') requirementId: string,
    @Body() payload: UpdateRequirementStatusDto,
  ) {
    return this.requirementsService.updateRequirementStatus(requirementId, payload);
  }

  @Post(':requirementId/status')
  updateRequirementStatusCompat(
    @Param('requirementId') requirementId: string,
    @Body() payload: UpdateRequirementStatusDto,
  ) {
    return this.requirementsService.updateRequirementStatus(requirementId, payload);
  }

  @Post(':requirementId/github/sync')
  syncRequirementToGithub(
    @Param('requirementId') requirementId: string,
    @Body() payload: SyncRequirementToGithubDto,
  ) {
    return this.requirementsService.syncRequirementToGithub(requirementId, payload);
  }
}
