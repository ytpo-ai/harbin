import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { BindChannelUserByEmailDto, CreateChannelUserMappingDto } from './dto/channel-user-mapping.dto';
import { ChannelUserMappingService } from './channel-user-mapping.service';

@Controller('channel/user-mappings')
export class ChannelUserMappingController {
  constructor(private readonly channelUserMappingService: ChannelUserMappingService) {}

  @Post()
  async createMapping(@Body() dto: CreateChannelUserMappingDto) {
    return this.channelUserMappingService.bindUser(dto);
  }

  @Get()
  async listMappings() {
    return this.channelUserMappingService.listMappings();
  }

  @Delete(':id')
  async deleteMapping(@Param('id') id: string) {
    return this.channelUserMappingService.unbindUser(id);
  }

  @Post('bind-by-email')
  async bindByEmail(@Body() dto: BindChannelUserByEmailDto) {
    return this.channelUserMappingService.bindByEmail(dto);
  }
}
