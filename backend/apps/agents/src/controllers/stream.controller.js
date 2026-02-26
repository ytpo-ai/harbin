"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentStreamController = void 0;
const common_1 = require("@nestjs/common");
const agent_service_1 = require("../../../../src/modules/agents/agent.service");
const infra_1 = require("@libs/infra");
let AgentStreamController = class AgentStreamController {
    constructor(agentService, redisService) {
        this.agentService = agentService;
        this.redisService = redisService;
    }
    async streamAgentTest(id, body) {
        const sessionId = body.sessionId;
        const channel = `stream:${sessionId}`;
        const startEvent = {
            sessionId,
            type: 'start',
            timestamp: Date.now(),
        };
        await this.redisService.publish(channel, startEvent);
        const result = await this.agentService.testAgentConnection(id, {
            model: body.model,
            apiKeyId: body.apiKeyId,
        });
        if (!result.success) {
            const errorEvent = {
                sessionId,
                type: 'error',
                payload: result.error || 'Unknown stream error',
                timestamp: Date.now(),
            };
            await this.redisService.publish(channel, errorEvent);
            return { success: false, channel, sessionId };
        }
        const text = result.response || '';
        const tokens = text.split(/(\s+)/).filter(Boolean);
        for (const token of tokens) {
            const chunkEvent = {
                sessionId,
                type: 'chunk',
                payload: token,
                timestamp: Date.now(),
            };
            await this.redisService.publish(channel, chunkEvent);
        }
        const doneEvent = {
            sessionId,
            type: 'done',
            timestamp: Date.now(),
        };
        await this.redisService.publish(channel, doneEvent);
        return { success: true, channel, sessionId };
    }
};
exports.AgentStreamController = AgentStreamController;
__decorate([
    (0, common_1.Post)(':id/test-stream'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AgentStreamController.prototype, "streamAgentTest", null);
exports.AgentStreamController = AgentStreamController = __decorate([
    (0, common_1.Controller)('agents'),
    __metadata("design:paramtypes", [agent_service_1.AgentService, typeof (_a = typeof infra_1.RedisService !== "undefined" && infra_1.RedisService) === "function" ? _a : Object])
], AgentStreamController);
//# sourceMappingURL=stream.controller.js.map