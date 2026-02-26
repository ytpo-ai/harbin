import { Logger } from '@nestjs/common';

export function createServiceLogger(scope: string): Logger {
  return new Logger(scope);
}
