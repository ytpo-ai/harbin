import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  CreateOpencodeSessionDto,
  PromptOpencodeSessionDto,
  SendOpencodePromptDto,
  SyncOpencodeContextDto,
} from '../dto';
import { EiManagementService } from './management.service';

@Injectable()
export class EiOpencodeService {
  constructor(private readonly core: EiManagementService) {}

  sendOpencodePrompt(taskId: string, payload: SendOpencodePromptDto) {
    return this.core.sendOpencodePrompt(taskId, payload);
  }

  createOpencodeSession(taskId: string, projectPath: string) {
    return this.core.createOpencodeSession(taskId, projectPath);
  }

  getOpencodeHistory(taskId: string) {
    return this.core.getOpencodeSessionHistory(taskId);
  }

  getCurrentOpencodeContext() {
    return this.core.getCurrentOpencodeContext();
  }

  getOpencodeProjects(options?: { endpoint?: string; endpointRef?: string; authEnable?: boolean }) {
    return this.core.listOpencodeProjects(options);
  }

  getOpencodeSessions(directory?: string, options?: { endpoint?: string; endpointRef?: string; authEnable?: boolean }) {
    return this.core.listOpencodeSessions(directory, options);
  }

  getOpencodeSession(sessionId: string) {
    return this.core.getOpencodeSession(sessionId);
  }

  getOpencodeSessionMessages(sessionId: string) {
    return this.core.getOpencodeSessionMessages(sessionId);
  }

  createOpencodeSessionStandalone(payload: CreateOpencodeSessionDto) {
    return this.core.createStandaloneOpencodeSession(payload);
  }

  promptOpencodeSession(sessionId: string, payload: PromptOpencodeSessionDto) {
    return this.core.promptOpencodeSession({
      sessionId,
      prompt: payload.prompt,
      model: payload.model,
      endpoint: payload.endpoint,
      endpointRef: payload.endpointRef,
      authEnable: payload.auth_enable,
    });
  }

  streamOpencodeEvents(
    token: string,
    authResolver: (authHeader: string) => Promise<unknown>,
    options?: { endpoint?: string; endpointRef?: string; authEnable?: boolean },
  ): Observable<MessageEvent> {
    const authHeader = token ? `Bearer ${token}` : '';
    return new Observable<MessageEvent>((subscriber) => {
      let cleanup: (() => void) | null = null;

      authResolver(authHeader)
        .then(() =>
          this.core.subscribeOpencodeEvents({
            onEvent: (event) => {
              subscriber.next({ data: event });
            },
            onError: (error) => {
              subscriber.next({
                data: {
                  type: 'error',
                  message: error?.message || 'OpenCode event stream error',
                },
              });
            },
            onComplete: () => {
              subscriber.complete();
            },
          }, options),
        )
        .then((fn) => {
          cleanup = fn;
        })
        .catch((error) => {
          subscriber.next({
            data: {
              type: 'error',
              message: error?.message || 'Failed to subscribe OpenCode events',
            },
          });
          subscriber.complete();
        });

      return () => {
        if (cleanup) {
          cleanup();
        }
      };
    });
  }

  syncCurrentOpencodeToTask(taskId: string, payload: SyncOpencodeContextDto) {
    return this.core.syncOpencodeToTask(taskId, payload || {});
  }
}
