import { CanActivate, ExecutionContext } from '@nestjs/common';
export declare class GatewayAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean;
}
