import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';
import { hashPassword } from '../../src/shared/utils/password.util';
import { EmployeeRole, EmployeeStatus, EmployeeType } from '../../src/shared/schemas/employee.schema';

type SeedArgs = {
  email: string;
  name: string;
  password: string;
};

function printUsage(): void {
  console.log('Usage: pnpm run seed:initial-admin -- --email=<email> --name="<name>" --password="<password>"');
  console.log('Example: pnpm run seed:initial-admin -- --email=admin@example.com --name="System Admin" --password="StrongPass123"');
}

function readArgValue(args: string[], key: string): string | undefined {
  const byEq = args.find((item) => item.startsWith(`--${key}=`));
  if (byEq) {
    return byEq.slice(key.length + 3).trim();
  }

  const keyIndex = args.findIndex((item) => item === `--${key}`);
  if (keyIndex >= 0) {
    const next = args[keyIndex + 1];
    if (next && !next.startsWith('--')) {
      return String(next).trim();
    }
  }

  return undefined;
}

function parseArgs(rawArgs: string[]): SeedArgs {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const email = String(readArgValue(rawArgs, 'email') || '').trim().toLowerCase();
  const name = String(readArgValue(rawArgs, 'name') || '').trim();
  const password = String(readArgValue(rawArgs, 'password') || '');

  if (!email || !name || !password) {
    throw new Error('Missing required args: --email, --name, --password');
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    throw new Error('Invalid email format');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  return { email, name, password };
}

async function seedInitialAdminUser(args: SeedArgs): Promise<void> {
  bootstrapEnv();

  const mongoUri = getMongoUri();
  await mongoose.connect(mongoUri);

  try {
    const collection = mongoose.connection.collection('employees');
    const existing = await collection.findOne({
      email: args.email,
      type: EmployeeType.HUMAN,
    });

    if (existing) {
      console.log(`[seed:initial-admin] skipped: employee already exists for ${args.email}`);
      return;
    }

    const now = new Date();
    await collection.insertOne({
      id: uuidv4(),
      type: EmployeeType.HUMAN,
      email: args.email,
      name: args.name,
      passwordHash: hashPassword(args.password),
      role: EmployeeRole.FOUNDER,
      tier: 'leadership',
      title: '系统管理员',
      status: EmployeeStatus.ACTIVE,
      joinDate: now,
      shares: 0,
      stockOptions: 0,
      salary: 0,
      capabilities: [],
      permissions: [],
      toolAccess: [],
      allowAIProxy: false,
      meetingPreferences: {
        autoJoin: true,
        notifications: true,
        preferredMeetingTypes: [],
      },
      performance: {
        overallScore: 0,
        taskCompletionRate: 0,
        codeQuality: 0,
        collaboration: 0,
        innovation: 0,
        efficiency: 0,
        totalEvaluations: 0,
      },
      statistics: {
        totalTasks: 0,
        completedTasks: 0,
        totalTokens: 0,
        totalCost: 0,
        meetingsAttended: 0,
        meetingsHosted: 0,
      },
      createdAt: now,
      updatedAt: now,
    });

    console.log(`[seed:initial-admin] created initial admin user: ${args.email}`);
  } finally {
    await mongoose.disconnect();
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await seedInitialAdminUser(args);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  console.error(`[seed:initial-admin] failed: ${message}`);
  printUsage();
  process.exit(1);
});
