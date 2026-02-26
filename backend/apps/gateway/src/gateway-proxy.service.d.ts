import { GatewayUserContext } from '@libs/contracts';
export declare class GatewayProxyService {
    private readonly logger;
    private readonly agentsBaseUrl;
    private readonly legacyBaseUrl;
    private readonly contextSecret;
    resolveTarget(originalUrl: string): string;
    buildSignedHeaders(userContext?: GatewayUserContext): Record<string, string>;
    forward(req: any, res: any): Promise<void>;
}
