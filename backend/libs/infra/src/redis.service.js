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
var RedisService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = require("ioredis");
const common_2 = require("@libs/common");
let RedisService = RedisService_1 = class RedisService {
    constructor() {
        this.logger = (0, common_2.createServiceLogger)(RedisService_1.name);
        this.redisUrl = this.buildRedisUrl();
        this.listeners = new Map();
        this.ready = false;
        const redisOptions = {
            lazyConnect: true,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            retryStrategy: () => null,
        };
        this.publisher = new ioredis_1.default(this.redisUrl, redisOptions);
        this.subscriber = new ioredis_1.default(this.redisUrl, redisOptions);
        this.publisher.on('error', (err) => {
            this.ready = false;
            this.logger.warn(`Redis publisher unavailable: ${err.message}`);
        });
        this.subscriber.on('error', (err) => {
            this.ready = false;
            this.logger.warn(`Redis subscriber unavailable: ${err.message}`);
        });
        this.subscriber.on('message', (channel, message) => {
            const channelListeners = this.listeners.get(channel);
            if (!channelListeners)
                return;
            channelListeners.forEach((listener) => listener(message));
        });
        void this.initialize();
    }
    buildRedisUrl() {
        const password = process.env.REDIS_PASSWORD || '';
        const db = process.env.REDIS_DB || '0';
        const rawUrl = process.env.REDIS_URL;
        if (rawUrl) {
            try {
                const parsed = new URL(rawUrl);
                if (!parsed.password && password) {
                    parsed.password = password;
                }
                if (!parsed.pathname || parsed.pathname === '/') {
                    parsed.pathname = `/${db}`;
                }
                return parsed.toString();
            }
            catch {
            }
        }
        const host = process.env.REDIS_HOST || '127.0.0.1';
        const port = process.env.REDIS_PORT || '6379';
        const authPart = password ? `:${encodeURIComponent(password)}@` : '';
        return `redis://${authPart}${host}:${port}/${db}`;
    }
    async initialize() {
        try {
            await this.publisher.connect();
            await this.subscriber.connect();
            this.ready = true;
            this.logger.log(`Redis connected: ${this.redisUrl}`);
        }
        catch (error) {
            this.ready = false;
            const message = error instanceof Error ? error.message : 'Unknown redis connection error';
            this.logger.warn(`Redis disabled, falling back to no-op bus: ${message}`);
        }
    }
    async publish(channel, payload) {
        if (!this.ready)
            return 0;
        const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
        return this.publisher.publish(channel, message);
    }
    async subscribe(channel, listener) {
        if (!this.ready)
            return;
        const existing = this.listeners.get(channel) || new Set();
        const needsSubscribe = existing.size === 0;
        existing.add(listener);
        this.listeners.set(channel, existing);
        if (needsSubscribe) {
            await this.subscriber.subscribe(channel);
        }
    }
    async unsubscribe(channel, listener) {
        if (!this.ready)
            return;
        const existing = this.listeners.get(channel);
        if (!existing)
            return;
        existing.delete(listener);
        if (existing.size > 0)
            return;
        this.listeners.delete(channel);
        await this.subscriber.unsubscribe(channel);
    }
    async onModuleDestroy() {
        try {
            if (this.publisher.status === 'ready') {
                await this.publisher.quit();
            }
            if (this.subscriber.status === 'ready') {
                await this.subscriber.quit();
            }
        }
        catch {
        }
    }
};
exports.RedisService = RedisService;
exports.RedisService = RedisService = RedisService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], RedisService);
//# sourceMappingURL=redis.service.js.map