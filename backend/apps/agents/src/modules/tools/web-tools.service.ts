import { Injectable, Logger } from '@nestjs/common';
import { ComposioService } from './composio.service';
import { ExaService } from './exa.service';

type NormalizedSearchRow = { title: string; url: string; snippet: string; date?: string };

@Injectable()
export class WebToolsService {
  private readonly logger = new Logger(WebToolsService.name);

  constructor(
    private readonly composioService: ComposioService,
    private readonly exaService: ExaService,
  ) {}

  async performWebSearch(params: { query: string; maxResults?: number }, userId?: string): Promise<any> {
    if (!params?.query) {
      throw new Error('websearch requires parameter: query');
    }

    const searchResult = await this.searchWebWithDefaultProvider(params.query, params.maxResults || 10, userId);

    return {
      query: params.query,
      provider: searchResult.provider,
      results: searchResult.results,
      totalResults: searchResult.results.length,
      raw: searchResult.raw,
    };
  }

  async performWebSearchExa(params: { query: string; maxResults?: number }): Promise<any> {
    if (!params?.query) {
      throw new Error('websearch.exa requires parameter: query');
    }

    const exaResult = await this.exaService.webSearch(params.query, params.maxResults || 10);
    if (!exaResult.successful) {
      throw new Error(exaResult.error || 'Exa websearch failed');
    }

    const normalized = this.normalizeExaSearchRows(exaResult.data || {});
    return {
      query: params.query,
      provider: 'exa/auto',
      results: normalized,
      totalResults: normalized.length,
      raw: exaResult.data || {},
    };
  }

  async performWebSearchSerp(params: { query: string; maxResults?: number }, userId?: string): Promise<any> {
    if (!params?.query) {
      throw new Error('websearch.serp requires parameter: query');
    }

    const composioResult = await this.composioService.webSearch(params.query, params.maxResults || 10, userId);
    if (!composioResult.successful) {
      throw new Error(composioResult.error || 'Composio websearch failed');
    }

    const normalized = this.normalizeComposioSearchRows(composioResult.data || {});
    return {
      query: params.query,
      provider: 'composio/serpapi',
      results: normalized,
      totalResults: normalized.length,
      raw: composioResult.data || {},
    };
  }

  async searchWebWithDefaultProvider(
    query: string,
    maxResults: number,
    userId?: string,
  ): Promise<{
    provider: string;
    results: NormalizedSearchRow[];
    raw: any;
  }> {
    const exaResult = await this.exaService.webSearch(query, maxResults);
    if (exaResult.successful) {
      return {
        provider: 'exa/auto',
        results: this.normalizeExaSearchRows(exaResult.data || {}),
        raw: exaResult.data || {},
      };
    }

    this.logger.warn(`Exa search failed, fallback to Composio SERPAPI: ${exaResult.error || 'unknown error'}`);
    const composioResult = await this.composioService.webSearch(query, maxResults, userId);
    if (!composioResult.successful) {
      throw new Error(
        `Web search failed on both providers (exa, composio): exa=${exaResult.error || 'unknown'}; composio=${composioResult.error || 'unknown'}`,
      );
    }

    return {
      provider: 'composio/serpapi',
      results: this.normalizeComposioSearchRows(composioResult.data || {}),
      raw: composioResult.data || {},
    };
  }

  async performWebFetch(params: { url: string; maxChars?: number; timeoutMs?: number }): Promise<any> {
    const url = String(params?.url || '').trim();
    if (!url) {
      throw new Error('webfetch requires parameter: url');
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('webfetch requires http/https url');
    }

    const timeoutMs = Math.min(Math.max(Number(params?.timeoutMs || 12000), 3000), 30000);
    const maxChars = Math.min(Math.max(Number(params?.maxChars || 12000), 1000), 50000);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'user-agent': 'ai-agent-team-webfetch/1.0',
          accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`webfetch failed with status ${response.status}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const raw = await response.text();
      const cleanText = this.extractCleanText(raw);
      const truncated = cleanText.length > maxChars;

      return {
        url,
        status: response.status,
        contentType,
        title: this.extractHtmlTitle(raw),
        content: truncated ? cleanText.slice(0, maxChars) : cleanText,
        contentLength: cleanText.length,
        truncated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'webfetch unknown error';
      throw new Error(`webfetch failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async performContentExtract(params: { content: string; maxBullets?: number; maxNumericRows?: number }): Promise<any> {
    const rawContent = String(params?.content || '').trim();
    if (!rawContent) {
      throw new Error('content_extract requires parameter: content');
    }

    const text = this.extractCleanText(rawContent);
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const maxBullets = Math.min(Math.max(Number(params?.maxBullets || 8), 3), 20);
    const maxNumericRows = Math.min(Math.max(Number(params?.maxNumericRows || 12), 3), 30);

    const bullets = lines
      .filter((line) => line.length >= 18)
      .slice(0, maxBullets)
      .map((line) => `- ${line}`);

    const numericRows = lines
      .filter((line) => /\d/.test(line) && /[,:|\-]/.test(line) && line.length >= 8)
      .slice(0, maxNumericRows);

    return {
      text,
      bullets,
      numericRows,
      stats: {
        textLength: text.length,
        lineCount: lines.length,
        bulletCount: bullets.length,
        numericRowCount: numericRows.length,
      },
    };
  }

  private normalizeComposioSearchRows(raw: any): NormalizedSearchRow[] {
    const rows = raw?.organic || raw?.results?.organic_results || raw?.results || [];
    const organicResults = Array.isArray(rows) ? rows : [];
    return organicResults
      .map((item: any) => ({
        title: String(item?.title || '').trim(),
        url: String(item?.link || item?.url || '').trim(),
        snippet: String(item?.snippet || '').trim(),
        date: String(item?.date || '').trim() || undefined,
      }))
      .filter((item) => item.title || item.url || item.snippet);
  }

  private normalizeExaSearchRows(raw: any): NormalizedSearchRow[] {
    const rows = Array.isArray(raw?.results) ? raw.results : [];
    return rows
      .map((item: any) => {
        const highlights = Array.isArray(item?.highlights)
          ? item.highlights.filter((value: unknown) => typeof value === 'string')
          : [];
        const snippet = String(highlights[0] || item?.text || '').trim();
        return {
          title: String(item?.title || '').trim(),
          url: String(item?.url || '').trim(),
          snippet,
          date: String(item?.published_date || item?.publishedDate || '').trim() || undefined,
        };
      })
      .filter((item) => item.title || item.url || item.snippet);
  }

  private extractHtmlTitle(raw: string): string | undefined {
    const match = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match?.[1]) {
      return undefined;
    }
    return match[1].replace(/\s+/g, ' ').trim();
  }

  private extractCleanText(raw: string): string {
    return raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
}
