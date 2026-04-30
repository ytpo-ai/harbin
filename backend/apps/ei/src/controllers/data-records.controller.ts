import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { AggregateDataRecordsDto, CleanupDataRecordsDto, QueryDataRecordsDto } from '../dto';
import { EiDataRecordsService } from '../services/ei-data-records.service';

@Controller('ei/data-records')
export class EiDataRecordsController {
  constructor(private readonly dataRecordsService: EiDataRecordsService) {}

  @Get()
  list(@Query() query: QueryDataRecordsDto) {
    return this.dataRecordsService.list(query);
  }

  @Get('aggregate')
  aggregate(@Query() query: AggregateDataRecordsDto) {
    return this.dataRecordsService.aggregate(query);
  }

  @Delete()
  cleanup(@Query() query: CleanupDataRecordsDto) {
    return this.dataRecordsService.cleanup(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.dataRecordsService.getById(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.dataRecordsService.deleteById(id);
  }
}
