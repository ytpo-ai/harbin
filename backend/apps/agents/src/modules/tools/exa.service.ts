import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ExaSearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    published_date?: string;
    publishedDate?: string;
    text?: string;
    highlights?: string[];
  }>;
}

interface ExaToolResponse {
  successful: boolean;
  data?: ExaSearchResponse;
  error?: string;
}

@Injectable()
export class ExaService {
  private readonly logger = new Logger(ExaService.name);
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.exa.ai';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('EXA_API_KEY');
    if (!this.isConfigured()) {
      this.logger.warn('EXA_API_KEY not configured, Exa search unavailable');
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey !== 'YOUR_API_KEY';
  }

  async webSearch(query: string, maxResults = 10): Promise<ExaToolResponse> {
    if (!this.isConfigured()) {
      return {
        successful: false,
        error: 'EXA_API_KEY not configured',
      };
    }

    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) {
      return {
        successful: false,
        error: 'Exa search query is empty',
      };
    }

    const payload = {
      query: trimmedQuery,
      type: 'auto',
      num_results: Math.min(Math.max(Number(maxResults || 10), 1), 20),
      contents: {
        highlights: {
          max_characters: 4000,
        },
      },
    };

    try {
      const response = await fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey as string,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        return {
          successful: false,
          error: `Exa search failed with status ${response.status}: ${text.slice(0, 300)}`,
        };
      }

      const data = (await response.json()) as ExaSearchResponse;
      return {
        successful: true,
        data,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Exa search error';
      this.logger.error('Exa webSearch execution failed', error as Error);
      return {
        successful: false,
        error: message,
      };
    }
  }
}
