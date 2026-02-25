import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiKeyService, CreateApiKeyDto, UpdateApiKeyDto } from './api-key.service';

@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get()
  async getAllApiKeys() {
    return this.apiKeyService.getAllApiKeys();
  }

  @Get('stats')
  async getStats() {
    return this.apiKeyService.getApiKeyStats();
  }

  @Get('by-provider/:provider')
  async getByProvider(@Param('provider') provider: string) {
    return this.apiKeyService.getApiKeysByProvider(provider);
  }

  @Get(':id')
  async getApiKey(@Param('id') id: string) {
    const apiKey = await this.apiKeyService.getApiKey(id);
    if (!apiKey) {
      return { error: 'API Key not found' };
    }
    return apiKey;
  }

  @Post()
  async createApiKey(@Body() apiKeyData: CreateApiKeyDto) {
    const created = await this.apiKeyService.createApiKey(apiKeyData);
    return {
      ...created,
      message: 'API Key created and encrypted successfully'
    };
  }

  @Put(':id')
  async updateApiKey(@Param('id') id: string, @Body() updates: UpdateApiKeyDto) {
    const updated = await this.apiKeyService.updateApiKey(id, updates);
    if (!updated) {
      return { error: 'API Key not found' };
    }
    return {
      ...updated,
      message: 'API Key updated successfully'
    };
  }

  @Delete(':id')
  async deleteApiKey(@Param('id') id: string) {
    const deleted = await this.apiKeyService.deleteApiKey(id);
    if (!deleted) {
      return { error: 'API Key not found' };
    }
    return { message: 'API Key deleted successfully' };
  }
}
