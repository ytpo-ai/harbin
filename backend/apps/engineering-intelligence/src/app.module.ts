import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EngineeringIntelligenceModule } from './modules/engineering-intelligence/engineering-intelligence.module';
import appConfig from '../../../src/config/app.config';
import databaseConfig from '../../../src/config/database.config';
import aiConfig from '../../../src/config/ai.config';
import jwtConfig from '../../../src/config/jwt.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, databaseConfig, aiConfig, jwtConfig],
    }),
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
    EngineeringIntelligenceModule,
  ],
})
export class EngineeringIntelligenceAppModule {}
