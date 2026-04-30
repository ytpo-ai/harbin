import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  CollectDataSourceDto,
  CreateDataSourceDto,
  QueryDataSourcesDto,
  TestDataSourceDto,
  UpdateDataSourceDto,
} from '../dto';
import { EiDataSourcesService } from '../services/ei-data-sources.service';

@Controller('ei/data-sources')
export class EiDataSourcesController {
  constructor(private readonly dataSourcesService: EiDataSourcesService) {}

  @Post()
  create(@Body() payload: CreateDataSourceDto) {
    return this.dataSourcesService.create(payload);
  }

  @Get()
  list(@Query() query: QueryDataSourcesDto) {
    return this.dataSourcesService.list(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.dataSourcesService.getById(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() payload: UpdateDataSourceDto) {
    return this.dataSourcesService.update(id, payload);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.dataSourcesService.remove(id);
  }

  @Post(':id/test')
  test(@Param('id') id: string, @Body() payload: TestDataSourceDto) {
    return this.dataSourcesService.test(id, payload);
  }

  @Post(':id/collect')
  collect(@Param('id') id: string, @Body() payload: CollectDataSourceDto) {
    return this.dataSourcesService.collect(id, payload);
  }
}
