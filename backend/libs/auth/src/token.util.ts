import * as crypto from 'crypto';

export interface EmployeeJwtPayload {
  employeeId: string;
  email?: string;
  exp: number;
}

export function verifyEmployeeToken(token: string, secret: string): EmployeeJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as EmployeeJwtPayload;
    if (!parsed.exp || parsed.exp < Date.now()) return null;

    return parsed;
  } catch {
    return null;
  }
}
