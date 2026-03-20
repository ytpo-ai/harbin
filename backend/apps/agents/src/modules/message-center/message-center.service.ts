import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  InnerMessage,
  InnerMessageDocument,
  InnerMessageMode,
  InnerMessageStatus,
} from '@agents/schemas/inner-message.schema';

interface ListInnerMessagesQuery {
  page?: number;
  pageSize?: number;
  mode?: InnerMessageMode;
  status?: InnerMessageStatus;
  eventType?: string;
}

@Injectable()
export class MessageCenterService {
  constructor(
    @InjectModel(InnerMessage.name)
    private readonly innerMessageModel: Model<InnerMessageDocument>,
  ) {}

  async listInnerMessages(query: ListInnerMessagesQuery) {
    const page = Math.max(1, Math.min(Number(query.page || 1), 10000));
    const pageSize = Math.max(1, Math.min(Number(query.pageSize || 20), 100));
    const skip = (page - 1) * pageSize;

    const filter: Record<string, any> = {};
    if (query.mode) {
      filter.mode = query.mode;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.eventType?.trim()) {
      filter.eventType = query.eventType.trim();
    }

    const [total, list] = await Promise.all([
      this.innerMessageModel.countDocuments(filter).exec(),
      this.innerMessageModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
    ]);

    return {
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      items: list,
      fetchedAt: new Date().toISOString(),
    };
  }
}
