import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InnerMessage,
  InnerMessageSchema,
} from '@agents/schemas/inner-message.schema';
import { MessageCenterController } from './message-center.controller';
import { MessageCenterService } from './message-center.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: InnerMessage.name, schema: InnerMessageSchema }])],
  controllers: [MessageCenterController],
  providers: [MessageCenterService],
})
export class MessageCenterModule {}
