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

  @Get('debug/status')
  getDebugStatus() {
    const models = this.modelService.getAvailableModels();
    return {
      registeredModels: models.length,
      models: models.map(m => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        model: m.model
      })),
      timestamp: new Date().toISOString()
    };
  }

  @Post(':modelId/chat')
  async chat(@Param('modelId') modelId: string, @Body() body: { messages: ChatMessage[], options?: any }) {
    const response = await this.modelService.chat(modelId, body.messages, body.options);
    return { response };
  }

  @Post(':modelId/test')
  async testModel(@Param('modelId') modelId: string) {
    const testMessages: ChatMessage[] = [
      {
        role: 'user',
        content: 'Hello! Please respond with "AI Model Connected Successfully"',
        timestamp: new Date()
      }
    ];
    
    try {
      const startTime = Date.now();
      const response = await this.modelService.chat(modelId, testMessages, {
        temperature: 0.7,
        maxTokens: 100
      });
      const duration = Date.now() - startTime;
      
      return {
        success: true,
        modelId,
        response,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        modelId,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Post(':modelId/register')
  registerModel(@Param('modelId') modelId: string, @Body() model: AIModel) {
    this.modelService.registerProvider(model);
    return { message: 'Model registered successfully' };
  }
}