import mongoose from 'mongoose';
import { bootstrapEnv, getMongoUri } from './shared/env-loader';
import { EncryptionUtil } from '../src/shared/utils/encryption.util';

type ChannelConfigSeedDoc = {
  name: string;
  providerType: 'feishu';
  targetType: 'group' | 'user';
  providerConfig: {
    webhookUrlEncrypted: string;
    webhookSecretEncrypted?: string;
  };
  eventFilters: string[];
  isActive: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
};

async function seedChannelConfig(): Promise<void> {
  bootstrapEnv();

  const webhookUrl = String(process.env.FEISHU_WEBHOOK_URL || '').trim();
  const webhookSecret = String(process.env.FEISHU_WEBHOOK_SECRET || '').trim() || undefined;
  if (!webhookUrl) {
    console.log('[seed:channel-config] skipped: FEISHU_WEBHOOK_URL is empty');
    return;
  }

  const mongoUri = getMongoUri();
  await mongoose.connect(mongoUri);

  try {
    const collection = mongoose.connection.collection('channel_configs');
    const now = new Date();
    const doc: ChannelConfigSeedDoc = {
      name: '飞书研发群通知',
      providerType: 'feishu',
      targetType: 'group',
      providerConfig: {
        webhookUrlEncrypted: EncryptionUtil.encrypt(webhookUrl),
        webhookSecretEncrypted: webhookSecret ? EncryptionUtil.encrypt(webhookSecret) : undefined,
      },
      eventFilters: ['orchestration.task.completed'],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const existing = await collection.findOne({
      providerType: 'feishu',
      name: doc.name,
    });

    if (existing?._id) {
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            providerConfig: doc.providerConfig,
            eventFilters: doc.eventFilters,
            isActive: doc.isActive,
            updatedAt: now,
          },
        },
      );
      console.log('[seed:channel-config] updated existing feishu config');
    } else {
      await collection.insertOne(doc);
      console.log('[seed:channel-config] inserted feishu config');
    }
  } finally {
    await mongoose.disconnect();
  }
}

seedChannelConfig().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error || 'unknown');
  console.error(`[seed:channel-config] failed: ${reason}`);
  process.exit(1);
});
