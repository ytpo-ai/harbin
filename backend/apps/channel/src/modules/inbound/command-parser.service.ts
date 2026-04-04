import { Injectable } from '@nestjs/common';

export type ParsedChannelCommandType = 'plan' | 'status' | 'cancel' | 'agent' | 'help' | 'chat' | 'new' | 'bind';

export interface ParsedChannelCommand {
  type: ParsedChannelCommandType;
  args: Record<string, string>;
  rawText: string;
}

@Injectable()
export class CommandParserService {
  parse(text: string): ParsedChannelCommand {
    const rawText = String(text || '').trim();

    if (rawText.startsWith('/plan ')) {
      return {
        type: 'plan',
        args: { prompt: rawText.slice('/plan '.length).trim() },
        rawText,
      };
    }

    if (rawText.startsWith('/status')) {
      return {
        type: 'status',
        args: { planId: rawText.slice('/status'.length).trim() },
        rawText,
      };
    }

    if (rawText.startsWith('/cancel ')) {
      return {
        type: 'cancel',
        args: { id: rawText.slice('/cancel '.length).trim() },
        rawText,
      };
    }

    if (rawText.startsWith('/agent ')) {
      return {
        type: 'agent',
        args: this.parseAgentArgs(rawText.slice('/agent '.length).trim()),
        rawText,
      };
    }

    if (rawText === '/help') {
      return {
        type: 'help',
        args: {},
        rawText,
      };
    }

    if (rawText === '/new') {
      return {
        type: 'new',
        args: {},
        rawText,
      };
    }

    if (rawText.startsWith('/bind ')) {
      return {
        type: 'bind',
        args: {
          email: rawText.slice('/bind '.length).trim(),
        },
        rawText,
      };
    }

    return {
      type: 'chat',
      args: { prompt: rawText },
      rawText,
    };
  }

  private parseAgentArgs(input: string): Record<string, string> {
    const normalized = String(input || '').trim();
    if (!normalized) {
      return {
        agentId: '',
        prompt: '',
      };
    }

    const splitIndex = normalized.indexOf(' ');
    if (splitIndex < 0) {
      return {
        agentId: normalized,
        prompt: '',
      };
    }

    return {
      agentId: normalized.slice(0, splitIndex).trim(),
      prompt: normalized.slice(splitIndex + 1).trim(),
    };
  }
}
