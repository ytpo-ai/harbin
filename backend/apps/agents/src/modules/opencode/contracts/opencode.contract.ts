export interface OpenCodeAdapterSessionInfo {
  id: string;
  title?: string;
  createdAt?: string;
}

export interface OpenCodeAdapterEvent {
  type: string;
  sessionId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
  raw: unknown;
}

export interface OpenCodeCreateSessionInput {
  title?: string;
  config?: Record<string, unknown>;
  model?: {
    providerID: string;
    modelID: string;
  };
  runtime?: OpenCodeRuntimeOptions;
}

export interface OpenCodePromptInput {
  sessionId: string;
  prompt: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  runtime?: OpenCodeRuntimeOptions;
}

export interface OpenCodeRuntimeOptions {
  baseUrl?: string;
  authEnable?: boolean;
  requestTimeoutMs?: number;
}

export interface OpenCodeExecutionStartInput {
  taskPrompt: string;
  sessionId?: string;
  title?: string;
  sessionConfig?: Record<string, unknown>;
  model?: {
    providerID: string;
    modelID: string;
  };
  runtime?: OpenCodeRuntimeOptions;
}

export interface OpenCodeExecutionStartResult {
  sessionId: string;
  response: string;
  metadata: Record<string, unknown>;
}
