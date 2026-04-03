import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { InfraModule } from '@libs/infra';
import databaseConfig from '../../../src/config/database.config';
import { HealthController } from './health.controller';
import { ChannelModule } from './modules/channel/channel.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development', '.env'],
      load: [databaseConfig],
    }),
    InfraModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const dbConfig = configService.get('database');
        return {
          uri: dbConfig.uri,
          ...dbConfig.options,
        };
      },
      inject: [ConfigService],
    }),
    ChannelModule,
  ],
  controllers: [HealthController],
})
export class ChannelAppModule {}
