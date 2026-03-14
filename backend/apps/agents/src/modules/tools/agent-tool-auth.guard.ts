import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AgentToolAuthService } from './agent-tool-auth.service';

@Injectable()
export class AgentToolAuthGuard implements CanActivate {
  constructor(private readonly authService: AgentToolAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const mode = this.authService.getAuthMode();
    const authHeader = req.headers.authorization as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (token) {
      const claims = await this.authService.verifyToken(token);
      const bodyAgentId = String(req.body?.agentId || '').trim();
      if (bodyAgentId && bodyAgentId !== claims.agentId) {
        throw new UnauthorizedException('agentId in request body does not match token subject');
      }
      req.agentToolAuth = {
        mode: 'jwt',
        agentId: claims.agentId,
        scopes: claims.toolScopes || [],
        permissions: claims.permissions || [],
        jti: claims.jti,
        originSessionId: claims.originSessionId,
      };
      return true;
    }

    if (mode === 'jwt-strict') {
      throw new UnauthorizedException('Missing Bearer token');
    }

    if (req.userContext) {
      req.agentToolAuth = {
        mode: 'internal-context',
        agentId: String(req.body?.agentId || '').trim() || undefined,
        scopes: ['tool:execute:*'],
      };
      return true;
    }

    if (mode === 'legacy') {
      return true;
    }

    throw new UnauthorizedException('Missing authorization context');
  }
}
