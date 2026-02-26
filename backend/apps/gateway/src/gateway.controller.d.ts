import { GatewayProxyService } from './gateway-proxy.service';
export declare class GatewayController {
    private readonly proxyService;
    constructor(proxyService: GatewayProxyService);
    health(): {
        service: string;
        status: string;
        timestamp: string;
    };
    proxy(req: any, res: any): Promise<void>;
}
