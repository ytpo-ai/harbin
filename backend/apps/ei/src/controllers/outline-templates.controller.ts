import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApplyOutlineTemplateDto,
  CreateOutlineTemplateDto,
  QueryOutlineTemplatesDto,
  UpdateOutlineTemplateDto,
} from '../dto';
import { EiOutlineTemplatesService } from '../services/ei-outline-templates.service';

@Controller('ei/outline-templates')
export class EiOutlineTemplatesController {
  constructor(private readonly outlineTemplatesService: EiOutlineTemplatesService) {}

  @Get()
  list(@Query() query: QueryOutlineTemplatesDto) {
    return this.outlineTemplatesService.list(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.outlineTemplatesService.getById(id);
  }

  @Post()
  create(@Body() payload: CreateOutlineTemplateDto) {
    return this.outlineTemplatesService.create(payload);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() payload: UpdateOutlineTemplateDto) {
    return this.outlineTemplatesService.update(id, payload);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.outlineTemplatesService.remove(id);
  }

  @Post(':id/apply')
  apply(@Param('id') id: string, @Body() payload: ApplyOutlineTemplateDto) {
    return this.outlineTemplatesService.apply(id, payload);
  }
}
