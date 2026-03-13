import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { SystemMessage, SystemMessageSchema } from '../../shared/schemas/system-message.schema';
import { MessageCenterController } from './message-center.controller';
import { MessageCenterService } from './message-center.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: SystemMessage.name, schema: SystemMessageSchema }]),
  ],
  controllers: [MessageCenterController],
  providers: [MessageCenterService],
  exports: [MessageCenterService],
})
export class MessageCenterModule {}
