import { All, Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { GatewayAuthGuard } from './gateway-auth.guard';
import { GatewayProxyService } from './gateway-proxy.service';

@Controller('api')
@UseGuards(GatewayAuthGuard)
export class GatewayController {
  constructor(private readonly proxyService: GatewayProxyService) {}

  @Get('health')
  health() {
    return {
      service: 'gateway',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @All('*')
  async proxy(@Req() req: any, @Res() res: any): Promise<void> {
    await this.proxyService.forward(req, res);
  }
}
