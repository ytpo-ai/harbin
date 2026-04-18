import { BullModule } from '@nestjs/bull';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls: boolean;
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConfig = configService.get<RedisConfig>('redis') as RedisConfig;

        return {
          redis: {
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password,
            db: redisConfig.db,
            tls: redisConfig.tls ? {} : undefined,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
