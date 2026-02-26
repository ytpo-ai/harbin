"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalContextMiddleware = void 0;
const common_1 = require("@nestjs/common");
const auth_1 = require("@libs/auth");
let InternalContextMiddleware = class InternalContextMiddleware {
    use(req, _res, next) {
        const path = req.originalUrl?.split('?')[0] || req.url;
        if (path === '/api/health') {
            next();
            return;
        }
        const encodedContext = req.headers['x-user-context'];
        const signature = req.headers['x-user-signature'];
        const secret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
        if (!encodedContext || !signature) {
            throw new common_1.UnauthorizedException('Missing internal user context');
        }
        const valid = (0, auth_1.verifyEncodedContext)(encodedContext, signature, secret);
        if (!valid) {
            throw new common_1.UnauthorizedException('Invalid internal user context signature');
        }
        req.userContext = (0, auth_1.decodeUserContext)(encodedContext);
        next();
    }
};
exports.InternalContextMiddleware = InternalContextMiddleware;
exports.InternalContextMiddleware = InternalContextMiddleware = __decorate([
    (0, common_1.Injectable)()
], InternalContextMiddleware);
//# sourceMappingURL=internal-context.middleware.js.map