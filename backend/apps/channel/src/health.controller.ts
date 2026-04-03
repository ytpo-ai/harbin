import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      service: 'channel',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
