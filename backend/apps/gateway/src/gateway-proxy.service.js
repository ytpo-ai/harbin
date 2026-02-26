"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var GatewayProxyService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayProxyService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("axios");
const auth_1 = require("@libs/auth");
let GatewayProxyService = GatewayProxyService_1 = class GatewayProxyService {
    constructor() {
        this.logger = new common_1.Logger(GatewayProxyService_1.name);
        this.agentsBaseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:3002';
        this.legacyBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001';
        this.contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
    }
    resolveTarget(originalUrl) {
        if (originalUrl.startsWith('/api/agents') ||
            originalUrl.startsWith('/api/tasks') ||
            originalUrl.startsWith('/api/meetings') ||
            originalUrl.startsWith('/api/discussions')) {
            return this.agentsBaseUrl;
        }
        return this.legacyBaseUrl;
    }
    buildSignedHeaders(userContext) {
        if (!userContext)
            return {};
        const encoded = (0, auth_1.encodeUserContext)(userContext);
        const signature = (0, auth_1.signEncodedContext)(encoded, this.contextSecret);
        return {
            'x-user-context': encoded,
            'x-user-signature': signature,
        };
    }
    async forward(req, res) {
        const targetBase = this.resolveTarget(req.originalUrl || req.url);
        const targetUrl = `${targetBase}${req.originalUrl || req.url}`;
        const headers = {};
        if (req.headers['content-type']) {
            headers['content-type'] = req.headers['content-type'];
        }
        if (req.headers.authorization) {
            headers.authorization = req.headers.authorization;
        }
        Object.assign(headers, this.buildSignedHeaders(req.userContext));
        const config = {
            url: targetUrl,
            method: req.method,
            headers,
            params: req.query,
            data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
            validateStatus: () => true,
            timeout: Number(process.env.GATEWAY_PROXY_TIMEOUT_MS || 30000),
            responseType: 'arraybuffer',
        };
        try {
            const response = await axios_1.default.request(config);
            Object.entries(response.headers || {}).forEach(([key, value]) => {
                if (value === undefined)
                    return;
                if (key.toLowerCase() === 'transfer-encoding')
                    return;
                res.setHeader(key, value);
            });
            res.status(response.status).send(response.data);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Gateway proxy error';
            this.logger.error(`Proxy failed: ${message}`);
            throw new common_1.InternalServerErrorException('Gateway proxy failed');
        }
    }
};
exports.GatewayProxyService = GatewayProxyService;
exports.GatewayProxyService = GatewayProxyService = GatewayProxyService_1 = __decorate([
    (0, common_1.Injectable)()
], GatewayProxyService);
//# sourceMappingURL=gateway-proxy.service.js.map