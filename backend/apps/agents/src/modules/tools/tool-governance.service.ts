import { Injectable } from '@nestjs/common';

export interface ToolGovernancePolicy {
  timeoutMs: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
  idempotencyTtlMs: number;
}

interface CircuitState {
  failures: number;
  openUntil: number;
  lastFailureAt: number;
}

@Injectable()
export class ToolGovernanceService {
  private readonly rateLimitHits = new Map<string, number[]>();
  private readonly circuitBreakers = new Map<string, CircuitState>();

  getGovernancePolicy(toolConfig?: Record<string, any>): ToolGovernancePolicy {
    const governance = (toolConfig?.governance || {}) as Record<string, any>;
    return {
      timeoutMs: this.parsePositiveInt(governance.timeoutMs ?? process.env.AGENTS_TOOL_TIMEOUT_MS, 30000),
      maxRetries: this.parsePositiveInt(governance.maxRetries ?? process.env.AGENTS_TOOL_RETRY_MAX, 1),
      rateLimitPerMinute: this.parsePositiveInt(
        governance.rateLimitPerMinute ?? process.env.AGENTS_TOOL_RATE_LIMIT_PER_MIN,
        120,
      ),
      circuitFailureThreshold: this.parsePositiveInt(
        governance.circuitFailureThreshold ?? process.env.AGENTS_TOOL_CIRCUIT_FAILURE_THRESHOLD,
        5,
      ),
      circuitOpenMs: this.parsePositiveInt(governance.circuitOpenMs ?? process.env.AGENTS_TOOL_CIRCUIT_OPEN_MS, 60000),
      idempotencyTtlMs: this.parsePositiveInt(
        governance.idempotencyTtlMs ?? process.env.AGENTS_TOOL_IDEMPOTENCY_TTL_MS,
        300000,
      ),
    };
  }

  getIdempotencyKey(parameters: any, executionContext?: { idempotencyKey?: string }): string | undefined {
    const fromContext = String(executionContext?.idempotencyKey || '').trim();
    if (fromContext) return fromContext;
    const fromParams = String(parameters?.idempotencyKey || parameters?.__idempotencyKey || '').trim();
    if (fromParams) return fromParams;
    return undefined;
  }

  enforceRateLimit(toolId: string, agentId: string, policy: ToolGovernancePolicy): void {
    const key = `${toolId}:${agentId}`;
    const now = Date.now();
    const windowStart = now - 60_000;
    const hits = (this.rateLimitHits.get(key) || []).filter((ts) => ts >= windowStart);
    if (hits.length >= policy.rateLimitPerMinute) {
      throw new Error(`rate limit exceeded for ${toolId}`);
    }
    hits.push(now);
    this.rateLimitHits.set(key, hits);
  }

  ensureCircuitClosed(toolId: string): void {
    const circuit = this.circuitBreakers.get(toolId);
    if (!circuit) return;
    if (circuit.openUntil > Date.now()) {
      throw new Error(`circuit open for ${toolId}`);
    }
  }

  recordCircuitSuccess(toolId: string): void {
    this.circuitBreakers.delete(toolId);
  }

  recordCircuitFailure(toolId: string, policy: ToolGovernancePolicy): void {
    const current = this.circuitBreakers.get(toolId) || { failures: 0, openUntil: 0, lastFailureAt: 0 };
    const failures = current.failures + 1;
    const now = Date.now();
    const openUntil = failures >= policy.circuitFailureThreshold ? now + policy.circuitOpenMs : 0;
    this.circuitBreakers.set(toolId, {
      failures,
      openUntil,
      lastFailureAt: now,
    });
  }

  async executeWithTimeout<T>(task: () => Promise<T>, timeoutMs: number): Promise<T> {
    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`execution timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  }

  async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  isRetryableCode(code: string): boolean {
    return code === 'TOOL_TIMEOUT' || code === 'TOOL_EXECUTION_FAILED' || code === 'TOOL_RATE_LIMITED';
  }

  parsePositiveInt(raw: unknown, fallback: number): number {
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.floor(num);
  }
}
