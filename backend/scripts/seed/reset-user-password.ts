import mongoose from 'mongoose';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';
import { hashPassword } from '../../src/shared/utils/password.util';
import { EmployeeType } from '../../src/shared/schemas/employee.schema';

type ResetArgs = {
  email: string;
  password: string;
};

function printUsage(): void {
  console.log('Usage: pnpm run seed:reset-password -- --email=<email> --password="<password>"');
  console.log('Example: pnpm run seed:reset-password -- --email=admin@example.com --password="StrongPass123"');
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

function parseArgs(rawArgs: string[]): ResetArgs {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const email = String(readArgValue(rawArgs, 'email') || '').trim().toLowerCase();
  const password = String(readArgValue(rawArgs, 'password') || '');

  if (!email || !password) {
    throw new Error('Missing required args: --email, --password');
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    throw new Error('Invalid email format');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  return { email, password };
}

async function resetUserPassword(args: ResetArgs): Promise<void> {
  bootstrapEnv();

  const mongoUri = getMongoUri();
  await mongoose.connect(mongoUri);

  try {
    const collection = mongoose.connection.collection('employees');
    const existing = await collection.findOne({
      email: args.email,
      type: EmployeeType.HUMAN,
    });

    if (!existing) {
      throw new Error(`Employee not found for ${args.email}`);
    }

    await collection.updateOne(
      { _id: existing._id },
      {
        $set: {
          passwordHash: hashPassword(args.password),
          updatedAt: new Date(),
        },
      }
    );

    console.log(`[seed:reset-password] password reset for ${args.email}`);
  } finally {
    await mongoose.disconnect();
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await resetUserPassword(args);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  console.error(`[seed:reset-password] failed: ${message}`);
  printUsage();
  process.exit(1);
});
