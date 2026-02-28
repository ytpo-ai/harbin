import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Composio } from '@composio/core';

interface ComposioToolExecution {
  toolName: string;
  input: Record<string, any>;
  userId?: string;
}

interface ComposioToolResponse {
  successful: boolean;
  data?: any;
  error?: string;
}

@Injectable()
export class ComposioService {
  private readonly logger = new Logger(ComposioService.name);
  private composio: Composio | null = null;
  private readonly apiKey: string | undefined;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('COMPOSIO_API_KEY');

    if (!this.isConfigured()) {
      this.logger.warn('Composio API key not configured');
      return;
    }

    try {
      this.composio = new Composio({ apiKey: this.apiKey });
      this.logger.log('Composio SDK initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Composio SDK', error as Error);
      this.composio = null;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey !== 'your_composio_api_key_here';
  }

  private getClient(): Composio {
    if (!this.composio) {
      throw new Error('Composio client not initialized');
    }
    return this.composio;
  }

  private getToolkitSlugFromToolName(toolName: string): string | null {
    if (toolName.startsWith('SERPAPI_')) return 'serpapi';
    if (toolName.startsWith('SLACK_')) return 'slack';
    if (toolName.startsWith('GMAIL_')) return 'gmail';
    return null;
  }

  private async resolveConnectedAccount(
    toolkitSlug: string,
    preferredUserId?: string,
  ): Promise<{ connectedAccountId: string; userId: string } | null> {
    const client = this.getClient();

    const query: Record<string, unknown> = {
      toolkit_slugs: [toolkitSlug],
      limit: 50,
    };
    if (preferredUserId) query.user_ids = [preferredUserId];

    const scoped = await (client as any).client.connectedAccounts.list(query as any);
    if (scoped.items?.length) {
      const account: any = scoped.items[0];
      return {
        connectedAccountId: account.id,
        userId: account.user_id || preferredUserId || 'default',
      };
    }

    const fallback = await (client as any).client.connectedAccounts.list({
      toolkit_slugs: [toolkitSlug],
      limit: 50,
    } as any);

    if (!fallback.items?.length) return null;

    const account: any = fallback.items[0];
    return {
      connectedAccountId: account.id,
      userId: account.user_id || preferredUserId || 'default',
    };
  }

  async executeTool(execution: ComposioToolExecution): Promise<ComposioToolResponse> {
    if (!this.isConfigured()) {
      throw new Error('Composio API key not configured');
    }

    try {
      const client = this.getClient();
      const preferredUserId = execution.userId || this.configService.get<string>('COMPOSIO_USER_ID') || undefined;
      const toolkitSlug = this.getToolkitSlugFromToolName(execution.toolName);
      const account = toolkitSlug ? await this.resolveConnectedAccount(toolkitSlug, preferredUserId) : null;

      const userId = account?.userId || preferredUserId || 'default';
      this.logger.log(`Executing ${execution.toolName} for user ${userId}`);

      const result = await client.tools.execute(execution.toolName, {
        userId,
        ...(account?.connectedAccountId ? { connectedAccountId: account.connectedAccountId } : {}),
        arguments: execution.input,
        dangerouslySkipVersionCheck: true,
      });

      return {
        successful: !!(result as any)?.successful,
        data: (result as any)?.data ?? result,
        error: (result as any)?.error || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Composio execution error';
      this.logger.error(`Composio tool execution failed: ${execution.toolName}`, error as Error);
      return {
        successful: false,
        error: message,
      };
    }
  }

  async webSearch(query: string, maxResults = 10, userId?: string): Promise<ComposioToolResponse> {
    return this.executeTool({
      toolName: 'SERPAPI_SEARCH',
      userId,
      input: {
        query,
        num: Math.min(maxResults, 20),
      },
    });
  }

  async slackSendMessage(channel: string, text: string, userId?: string): Promise<ComposioToolResponse> {
    const normalized = channel.startsWith('#') ? channel.slice(1) : channel;
    return this.executeTool({
      toolName: 'SLACK_SEND_MESSAGE',
      userId,
      input: {
        channel: normalized,
        text,
      },
    });
  }

  async gmailSendEmail(
    to: string,
    subject: string,
    body: string,
    action: 'draft' | 'send' = 'send',
    userId?: string,
  ): Promise<ComposioToolResponse> {
    return this.executeTool({
      toolName: action === 'draft' ? 'GMAIL_CREATE_EMAIL_DRAFT' : 'GMAIL_SEND_EMAIL',
      userId,
      input: {
        to,
        subject,
        body,
      },
    });
  }

  async listAvailableTools(): Promise<any[]> {
    if (!this.isConfigured() || !this.composio) return [];

    try {
      const tools = await this.composio.tools.getToolsEnum();
      if (Array.isArray(tools)) return tools;
      return (tools as any)?.items || [];
    } catch (error) {
      this.logger.error('Failed to list Composio tools', error as Error);
      return [];
    }
  }

  async getConnectedAccounts(userId?: string): Promise<any[]> {
    if (!this.isConfigured() || !this.composio) return [];

    try {
      const query: Record<string, unknown> = { limit: 100 };
      if (userId) query.user_ids = [userId];
      const response = await (this.composio as any).client.connectedAccounts.list(query as any);
      return response.items || [];
    } catch (error) {
      this.logger.error('Failed to get connected accounts', error as Error);
      return [];
    }
  }

  async isToolConnected(toolName: string, userId?: string): Promise<boolean> {
    const toolkit = this.getToolkitSlugFromToolName(toolName) || toolName.toLowerCase();
    const accounts = await this.getConnectedAccounts(userId);
    return accounts.some((a: any) => a?.toolkit?.slug === toolkit);
  }
}
