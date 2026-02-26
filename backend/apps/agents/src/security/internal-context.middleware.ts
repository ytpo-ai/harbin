import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { decodeUserContext, verifyEncodedContext } from '@libs/auth';

@Injectable()
export class InternalContextMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void): void {
    const path = req.originalUrl?.split('?')[0] || req.url;
    if (path === '/api/health') {
      next();
      return;
    }

    const encodedContext = req.headers['x-user-context'] as string | undefined;
    const signature = req.headers['x-user-signature'] as string | undefined;
    const secret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

    if (!encodedContext || !signature) {
      throw new UnauthorizedException('Missing internal user context');
    }

    const valid = verifyEncodedContext(encodedContext, signature, secret);
    if (!valid) {
      throw new UnauthorizedException('Invalid internal user context signature');
    }

    req.userContext = decodeUserContext(encodedContext);
    next();
  }
}
