import { NestMiddleware } from '@nestjs/common';
export declare class InternalContextMiddleware implements NestMiddleware {
    use(req: any, _res: any, next: () => void): void;
}
