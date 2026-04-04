import mongoose from 'mongoose';
import { bootstrapEnv, getMongoUri } from './shared/env-loader';
import { EncryptionUtil } from '../src/shared/utils/encryption.util';

type ChannelConfigSeedDoc = {
  name: string;
  providerType: 'feishu' | 'feishu-app';
  targetType: 'group' | 'user';
  providerConfig: {
    webhookUrlEncrypted?: string;
    webhookSecretEncrypted?: string;
    appIdEncrypted?: string;
    appSecretEncrypted?: string;
    encryptKeyEncrypted?: string;
    receiveId?: string;
    receiveIdType?: 'chat_id' | 'open_id';
  };
  eventFilters: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function resolveDefaultEventFilters(): string[] {
  const fromEnv = String(process.env.CHANNEL_FORWARD_EVENT_TYPES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (fromEnv.length) {
    return fromEnv;
  }

  return [
    'orchestration.task.completed',
    'agent.action.completed',
    'system.alert.scheduler',
    'meeting.session.ended',
    'meeting.summary.generated',
    'scheduler.report.generated',
  ];
}

async function seedChannelConfig(): Promise<void> {
  bootstrapEnv();

  const webhookUrl = String(process.env.FEISHU_WEBHOOK_URL || '').trim();
  const webhookSecret = String(process.env.FEISHU_WEBHOOK_SECRET || '').trim() || undefined;

  const mongoUri = getMongoUri();
  await mongoose.connect(mongoUri);

  try {
    const collection = mongoose.connection.collection('channel_configs');
    const now = new Date();
    const defaultEventFilters = resolveDefaultEventFilters();

    if (webhookUrl) {
      const webhookDoc: ChannelConfigSeedDoc = {
        name: '飞书研发群通知',
        providerType: 'feishu',
        targetType: 'group',
        providerConfig: {
          webhookUrlEncrypted: EncryptionUtil.encrypt(webhookUrl),
          webhookSecretEncrypted: webhookSecret ? EncryptionUtil.encrypt(webhookSecret) : undefined,
        },
        eventFilters: defaultEventFilters,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      const existingWebhook = await collection.findOne({
        providerType: 'feishu',
        name: webhookDoc.name,
      });

      if (existingWebhook?._id) {
        await collection.updateOne(
          { _id: existingWebhook._id },
          {
            $set: {
              providerConfig: webhookDoc.providerConfig,
              eventFilters: webhookDoc.eventFilters,
              isActive: webhookDoc.isActive,
              updatedAt: now,
            },
          },
        );
        console.log('[seed:channel-config] updated existing feishu config');
      } else {
        await collection.insertOne(webhookDoc);
        console.log('[seed:channel-config] inserted feishu config');
      }
    } else {
      console.log('[seed:channel-config] skipped feishu webhook seed: FEISHU_WEBHOOK_URL is empty');
    }

    const appId = String(process.env.FEISHU_APP_ID || '').trim();
    const appSecret = String(process.env.FEISHU_APP_SECRET || '').trim();
    const appEncryptKey = String(process.env.FEISHU_APP_ENCRYPT_KEY || '').trim() || undefined;
    const appReceiveId = String(process.env.FEISHU_APP_RECEIVE_ID || '').trim();
    const appTargetType = String(process.env.FEISHU_APP_TARGET_TYPE || 'group').trim() === 'user' ? 'user' : 'group';
    const appReceiveIdType = appTargetType === 'user' ? 'open_id' : 'chat_id';

    if (appId && appSecret && appReceiveId) {
      const appDoc: ChannelConfigSeedDoc = {
        name: `飞书${appTargetType === 'user' ? '个人' : '群聊'}通知(App)`,
        providerType: 'feishu-app',
        targetType: appTargetType,
        providerConfig: {
          appIdEncrypted: EncryptionUtil.encrypt(appId),
          appSecretEncrypted: EncryptionUtil.encrypt(appSecret),
          encryptKeyEncrypted: appEncryptKey ? EncryptionUtil.encrypt(appEncryptKey) : undefined,
          receiveId: appReceiveId,
          receiveIdType: appReceiveIdType,
        },
        eventFilters: defaultEventFilters,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      const existingApp = await collection.findOne({
        providerType: 'feishu-app',
        name: appDoc.name,
      });

      if (existingApp?._id) {
        await collection.updateOne(
          { _id: existingApp._id },
          {
            $set: {
              providerConfig: appDoc.providerConfig,
              targetType: appDoc.targetType,
              eventFilters: appDoc.eventFilters,
              isActive: appDoc.isActive,
              updatedAt: now,
            },
          },
        );
        console.log('[seed:channel-config] updated existing feishu-app config');
      } else {
        await collection.insertOne(appDoc);
        console.log('[seed:channel-config] inserted feishu-app config');
      }
    } else {
      console.log('[seed:channel-config] skipped feishu-app seed: FEISHU_APP_ID/FEISHU_APP_SECRET/FEISHU_APP_RECEIVE_ID incomplete');
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
