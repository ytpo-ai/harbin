import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { EiRepositoriesService } from '../services/repositories.service';
import { CreateEngineeringRepositoryDto, UpdateEngineeringRepositoryDto } from '../dto';

@Controller('ei/repositories')
export class EiRepositoriesController {
  constructor(private readonly repositoriesService: EiRepositoriesService) {}

  @Post()
  createRepository(@Body() dto: CreateEngineeringRepositoryDto) {
    return this.repositoriesService.createRepository(dto);
  }

  @Get()
  listRepositories() {
    return this.repositoriesService.listRepositories();
  }

  @Put(':id')
  updateRepository(@Param('id') id: string, @Body() dto: UpdateEngineeringRepositoryDto) {
    return this.repositoriesService.updateRepository(id, dto);
  }

  @Delete(':id')
  deleteRepository(@Param('id') id: string) {
    return this.repositoriesService.deleteRepository(id);
  }

  @Post(':id/summarize')
  summarizeRepository(@Param('id') id: string) {
    return this.repositoriesService.summarizeRepository(id);
  }

  @Get(':id/docs/tree')
  getDocsTree(@Param('id') id: string) {
    return this.repositoriesService.getRepositoryDocsTree(id);
  }

  @Get(':id/docs/content')
  getDocContent(@Param('id') id: string, @Query('path') docPath: string) {
    if (!docPath) {
      throw new BadRequestException('path is required');
    }
    return this.repositoriesService.getRepositoryDocContent(id, docPath);
  }

  @Get(':id/docs/history')
  getDocHistory(@Param('id') id: string, @Query('path') docPath: string, @Query('limit') limit: string) {
    if (!docPath) {
      throw new BadRequestException('path is required');
    }
    return this.repositoriesService.getRepositoryDocHistory(id, docPath, limit ? Number(limit) : undefined);
  }
}
