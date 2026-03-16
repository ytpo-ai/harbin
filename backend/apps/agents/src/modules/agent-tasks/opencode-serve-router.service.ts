import { Injectable, Logger } from '@nestjs/common';

export interface OpenCodeServeNode {
  serveId: string;
  baseUrl: string;
  authEnable: boolean;
  maxConcurrency: number;
  weight: number;
}

@Injectable()
export class OpenCodeServeRouterService {
  private readonly logger = new Logger(OpenCodeServeRouterService.name);
  private readonly registry: OpenCodeServeNode[];
  private readonly activeByServeId = new Map<string, number>();
  private rrCursor = 0;

  constructor() {
    this.registry = this.loadRegistry();
  }

  listRegistry(): OpenCodeServeNode[] {
    return this.registry;
  }

  resolveByServeId(serveId?: string): OpenCodeServeNode | null {
    if (!serveId) return null;
    return this.registry.find((item) => item.serveId === serveId) || null;
  }

  pickServe(): OpenCodeServeNode | null {
    if (this.registry.length === 0) {
      return null;
    }

    const weighted = this.registry
      .map((node) => {
        const active = this.activeByServeId.get(node.serveId) || 0;
        const capacity = Math.max(1, node.maxConcurrency);
        const loadRatio = active / capacity;
        const weightedLoad = loadRatio / Math.max(1, node.weight);
        return { node, weightedLoad, active };
      })
      .sort((a, b) => {
        if (a.weightedLoad === b.weightedLoad) {
          return a.node.serveId.localeCompare(b.node.serveId);
        }
        return a.weightedLoad - b.weightedLoad;
      });

    const leastLoad = weighted[0]?.weightedLoad;
    const candidates = weighted.filter((row) => row.weightedLoad === leastLoad).map((row) => row.node);
    if (!candidates.length) {
      return null;
    }

    const selected = candidates[this.rrCursor % candidates.length];
    this.rrCursor += 1;
    this.logger.debug(`Selected OpenCode serve ${selected.serveId}`);
    return selected;
  }

  markServeAcquire(serveId: string): void {
    const current = this.activeByServeId.get(serveId) || 0;
    this.activeByServeId.set(serveId, current + 1);
  }

  markServeRelease(serveId: string): void {
    const current = this.activeByServeId.get(serveId) || 0;
    if (current <= 1) {
      this.activeByServeId.delete(serveId);
      return;
    }
    this.activeByServeId.set(serveId, current - 1);
  }

  private loadRegistry(): OpenCodeServeNode[] {
    const raw = String(process.env.OPENCODE_SERVE_REGISTRY || '').trim();
    const fallbackBaseUrl = String(process.env.OPENCODE_SERVER_URL || '').trim();
    const fallbackAuthEnable = String(process.env.OPENCODE_SERVER_AUTH_ENABLE || '').trim().toLowerCase() === 'true';

    if (!raw) {
      if (!fallbackBaseUrl) {
        return [];
      }
      return [
        {
          serveId: 'default',
          baseUrl: fallbackBaseUrl,
          authEnable: fallbackAuthEnable,
          maxConcurrency: 16,
          weight: 1,
        },
      ];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      const nodes = parsed
        .map((item, index) => {
          const serveId = String(item?.serveId || item?.id || `serve-${index + 1}`).trim();
          const baseUrl = String(item?.baseUrl || '').trim();
          if (!baseUrl) {
            return null;
          }
          return {
            serveId,
            baseUrl,
            authEnable: item?.authEnable === true,
            maxConcurrency: Math.max(1, Number(item?.maxConcurrency || 16)),
            weight: Math.max(1, Number(item?.weight || 1)),
          } as OpenCodeServeNode;
        })
        .filter((item): item is OpenCodeServeNode => Boolean(item));

      return nodes;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Invalid OPENCODE_SERVE_REGISTRY, fallback to default: ${message}`);
      if (!fallbackBaseUrl) {
        return [];
      }
      return [
        {
          serveId: 'default',
          baseUrl: fallbackBaseUrl,
          authEnable: fallbackAuthEnable,
          maxConcurrency: 16,
          weight: 1,
        },
      ];
    }
  }
}
