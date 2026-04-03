import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ChannelConfigService } from './channel-config.service';
import { CreateChannelConfigDto, UpdateChannelConfigDto } from './dto/channel-config.dto';

@Controller('channel/configs')
export class ChannelConfigController {
  constructor(private readonly channelConfigService: ChannelConfigService) {}

  @Post()
  async createConfig(@Body() dto: CreateChannelConfigDto) {
    return this.channelConfigService.createConfig(dto);
  }

  @Get()
  async listConfigs() {
    return this.channelConfigService.listConfigs();
  }

  @Patch(':id')
  async updateConfig(@Param('id') id: string, @Body() dto: UpdateChannelConfigDto) {
    return this.channelConfigService.updateConfig(id, dto);
  }

  @Delete(':id')
  async deleteConfig(@Param('id') id: string) {
    return this.channelConfigService.deleteConfig(id);
  }

  @Post(':id/test')
  async testPush(@Param('id') id: string) {
    return this.channelConfigService.testPush(id);
  }
}
