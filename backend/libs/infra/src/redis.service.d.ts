import { OnModuleDestroy } from '@nestjs/common';
type MessageListener = (message: string) => void;
export declare class RedisService implements OnModuleDestroy {
    private readonly logger;
    private readonly redisUrl;
    private readonly publisher;
    private readonly subscriber;
    private readonly listeners;
    private ready;
    constructor();
    private buildRedisUrl;
    private initialize;
    publish(channel: string, payload: unknown): Promise<number>;
    subscribe(channel: string, listener: MessageListener): Promise<void>;
    unsubscribe(channel: string, listener: MessageListener): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
export {};
