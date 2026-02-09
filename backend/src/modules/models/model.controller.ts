import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ModelService } from './model.service';
import { AIModel, ChatMessage } from '../../shared/types';

@Controller('models')
export class ModelController {
  constructor(private readonly modelService: ModelService) {}

  @Get()
  getAvailableModels() {
    return this.modelService.getAvailableModels();
  }

  @Post(':modelId/chat')
  async chat(@Param('modelId') modelId: string, @Body() body: { messages: ChatMessage[], options?: any }) {
    const response = await this.modelService.chat(modelId, body.messages, body.options);
    return { response };
  }

  @Post(':modelId/register')
  registerModel(@Param('modelId') modelId: string, @Body() model: AIModel) {
    this.modelService.registerProvider(model);
    return { message: 'Model registered successfully' };
  }
}