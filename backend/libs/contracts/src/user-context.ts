export interface GatewayUserContext {
  employeeId: string;
  email?: string;
  organizationId?: string;
  role?: string;
  issuedAt: number;
  expiresAt: number;
}

export interface StreamChunkEvent {
  sessionId: string;
  type: 'start' | 'chunk' | 'done' | 'error';
  payload?: string;
  timestamp: number;
}
