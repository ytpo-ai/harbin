import * as crypto from 'crypto';
import { GatewayUserContext } from '@libs/contracts';

export function encodeUserContext(context: GatewayUserContext): string {
  return Buffer.from(JSON.stringify(context)).toString('base64url');
}

export function decodeUserContext(encoded: string): GatewayUserContext {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString()) as GatewayUserContext;
}

export function signEncodedContext(encoded: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
}

export function verifyEncodedContext(encoded: string, signature: string, secret: string): boolean {
  const expected = signEncodedContext(encoded, secret);
  return expected === signature;
}
