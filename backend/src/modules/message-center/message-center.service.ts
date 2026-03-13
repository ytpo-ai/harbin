import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SystemMessage, SystemMessageDocument, SystemMessageType } from '../../shared/schemas/system-message.schema';

export interface ListSystemMessagesQuery {
  receiverId: string;
  page?: number;
  pageSize?: number;
  isRead?: boolean;
  type?: SystemMessageType;
}

export interface CreateSystemMessageInput {
  receiverId: string;
  type: SystemMessageType;
  title: string;
  content: string;
  payload?: Record<string, any>;
  source?: string;
  status?: string;
}

@Injectable()
export class MessageCenterService {
  constructor(
    @InjectModel(SystemMessage.name)
    private readonly systemMessageModel: Model<SystemMessageDocument>,
  ) {}

  async listMessages(query: ListSystemMessagesQuery) {
    const page = Math.max(1, Math.min(Number(query.page || 1), 10000));
    const pageSize = Math.max(1, Math.min(Number(query.pageSize || 20), 100));
    const skip = (page - 1) * pageSize;

    const filter: Record<string, any> = {
      receiverId: query.receiverId,
      status: 'active',
    };

    if (typeof query.isRead === 'boolean') {
      filter.isRead = query.isRead;
    }

    if (query.type) {
      filter.type = query.type;
    }

    const [total, unreadCount, list] = await Promise.all([
      this.systemMessageModel.countDocuments(filter).exec(),
      this.systemMessageModel.countDocuments({ receiverId: query.receiverId, isRead: false, status: 'active' }).exec(),
      this.systemMessageModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
    ]);

    return {
      total,
      unreadCount,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      items: list,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getUnreadCount(receiverId: string): Promise<number> {
    return this.systemMessageModel.countDocuments({ receiverId, isRead: false, status: 'active' }).exec();
  }

  async markAsRead(receiverId: string, messageId: string) {
    const doc = await this.systemMessageModel
      .findOneAndUpdate(
        { receiverId, messageId, status: 'active' },
        {
          $set: {
            isRead: true,
            readAt: new Date(),
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!doc) {
      throw new NotFoundException('Message not found');
    }

    return doc;
  }

  async markAllAsRead(receiverId: string) {
    const result = await this.systemMessageModel
      .updateMany(
        { receiverId, isRead: false, status: 'active' },
        {
          $set: {
            isRead: true,
            readAt: new Date(),
          },
        },
      )
      .exec();

    return {
      updatedCount: result.modifiedCount || 0,
    };
  }

  async createSystemMessage(input: CreateSystemMessageInput) {
    if (!input.receiverId?.trim()) {
      throw new BadRequestException('receiverId is required');
    }

    if (!input.title?.trim() || !input.content?.trim()) {
      throw new BadRequestException('title and content are required');
    }

    return this.systemMessageModel.create({
      receiverId: input.receiverId,
      type: input.type,
      title: input.title,
      content: input.content,
      payload: input.payload || {},
      source: input.source || 'system',
      status: input.status || 'active',
      isRead: false,
    });
  }
}
