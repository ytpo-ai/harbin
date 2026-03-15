import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { GatewayController } from './gateway.controller';
import { GatewayProxyService } from './gateway-proxy.service';
import { GatewayAuthGuard } from './gateway-auth.guard';
import databaseConfig from '../../../src/config/database.config';
import { OperationLog, OperationLogSchema } from '../../../src/shared/schemas/operation-log.schema';
import { Employee, EmployeeSchema } from '../../../src/shared/schemas/employee.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development', '.env'],
      load: [databaseConfig],
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
    MongooseModule.forFeature([
      { name: OperationLog.name, schema: OperationLogSchema },
      { name: Employee.name, schema: EmployeeSchema },
    ]),
  ],
  controllers: [GatewayController],
  providers: [GatewayProxyService, GatewayAuthGuard],
})
export class GatewayAppModule {}
