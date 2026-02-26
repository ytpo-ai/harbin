"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const auth_1 = require("@libs/auth");
const PUBLIC_PATHS = new Set([
    '/api/auth/login',
    '/api/auth/verify',
    '/api/auth/refresh',
    '/api/invitations/validate',
    '/api/invitations/accept',
    '/api/health',
]);
let GatewayAuthGuard = class GatewayAuthGuard {
    canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const path = req.originalUrl?.split('?')[0] || req.url;
        if (PUBLIC_PATHS.has(path)) {
            return true;
        }
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            throw new common_1.UnauthorizedException('Missing Bearer token');
        }
        const token = authHeader.slice(7);
        const secret = process.env.JWT_SECRET || 'your-secret-key';
        const payload = (0, auth_1.verifyEmployeeToken)(token, secret);
        if (!payload) {
            throw new common_1.UnauthorizedException('Invalid or expired token');
        }
        const userContext = {
            employeeId: payload.employeeId,
            email: payload.email,
            organizationId: payload.organizationId,
            role: '',
            issuedAt: Date.now(),
            expiresAt: payload.exp,
        };
        req.userContext = userContext;
        return true;
    }
};
exports.GatewayAuthGuard = GatewayAuthGuard;
exports.GatewayAuthGuard = GatewayAuthGuard = __decorate([
    (0, common_1.Injectable)()
], GatewayAuthGuard);
//# sourceMappingURL=gateway-auth.guard.js.map