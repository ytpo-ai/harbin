import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentService, AgentTaskEvent, AgentTaskInfo } from '../services/agentService';

export type AgentTaskConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export function useAgentTaskSse(taskId?: string, enabled = true) {
  const [connectionState, setConnectionState] = useState<AgentTaskConnectionState>('idle');
  const [events, setEvents] = useState<AgentTaskEvent[]>([]);
  const [taskInfo, setTaskInfo] = useState<AgentTaskInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [heartbeatCount, setHeartbeatCount] = useState(0);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const lastEventIdRef = useRef<string | undefined>(undefined);
  const lastSequenceRef = useRef<number>(0);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const retryTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  const appendEvent = useCallback((event: AgentTaskEvent) => {
    if (!event?.id) return;
    if (seenEventIdsRef.current.has(event.id)) {
      return;
    }
    seenEventIdsRef.current.add(event.id);
    lastEventIdRef.current = event.id;
    if (Number.isFinite(event.sequence) && event.sequence > lastSequenceRef.current) {
      lastSequenceRef.current = event.sequence;
    }

    if (event.type === 'heartbeat') {
      setHeartbeatCount((prev) => prev + 1);
      setLastHeartbeatAt(event.timestamp || new Date().toISOString());
      return;
    }

    setEvents((prev) => {
      const next = [event, ...prev];
      return next.slice(0, 600);
    });
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (!taskId || pollTimerRef.current !== null) return;
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const latest = await agentService.getAgentTask(taskId);
        setTaskInfo(latest);
      } catch {
        // ignore polling errors
      }
    }, 5000);
  }, [taskId]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    setConnectionState('closed');
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    stopPolling();
  }, [stopPolling]);

  const refreshTaskInfo = useCallback(async () => {
    if (!taskId) return;
    const latest = await agentService.getAgentTask(taskId);
    setTaskInfo(latest);
  }, [taskId]);

  const connect = useCallback(async () => {
    if (!enabled || !taskId) return;

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setConnectionState((prev) => (prev === 'idle' ? 'connecting' : 'reconnecting'));
    setErrorMessage(null);

    try {
      await agentService.streamAgentTaskEvents({
        taskId,
        lastEventId: lastEventIdRef.current,
        lastSequence: lastSequenceRef.current,
        signal: controller.signal,
        onOpen: () => {
          setConnectionState('open');
          retryCountRef.current = 0;
          setRetryCount(0);
          stopPolling();
        },
        onEvent: (event) => {
          appendEvent(event);
          if (event.type === 'result' || event.type === 'error') {
            void refreshTaskInfo();
          }
        },
      });

      if (!stoppedRef.current) {
        const latest = await agentService.getAgentTask(taskId);
        setTaskInfo(latest);
        if (latest.status === 'running' || latest.status === 'queued') {
          throw new Error('SSE stream closed unexpectedly');
        }
      }
    } catch (error: any) {
      if (stoppedRef.current || controller.signal.aborted) {
        return;
      }

      const message = error?.message || 'SSE stream failed';
      setErrorMessage(message);
      const nextRetry = retryCountRef.current + 1;
      retryCountRef.current = nextRetry;
      setRetryCount(nextRetry);

      if (nextRetry >= 4) {
        startPolling();
      }

      const base = Math.min(20000, 1000 * Math.pow(2, Math.min(nextRetry, 5)));
      const jitter = Math.floor(Math.random() * 400);
      retryTimerRef.current = window.setTimeout(() => {
        void connect();
      }, base + jitter);
    }
  }, [appendEvent, enabled, refreshTaskInfo, startPolling, stopPolling, taskId]);

  useEffect(() => {
    stoppedRef.current = false;
    seenEventIdsRef.current = new Set();
    lastEventIdRef.current = undefined;
    lastSequenceRef.current = 0;
    setEvents([]);
    setTaskInfo(null);
    retryCountRef.current = 0;
    setRetryCount(0);
    setHeartbeatCount(0);
    setLastHeartbeatAt(null);

    if (!enabled || !taskId) {
      setConnectionState('idle');
      return () => undefined;
    }

    void refreshTaskInfo();
    void connect();

    return () => {
      stop();
    };
  }, [connect, enabled, refreshTaskInfo, stop, taskId]);

  const tokenText = useMemo(() => {
    const chunks: string[] = [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type !== 'token') continue;
      const token = String((event.payload?.token || event.payload?.delta || '') as string);
      if (token) chunks.push(token);
    }
    return chunks.join('');
  }, [events]);

  return {
    connectionState,
    events,
    taskInfo,
    tokenText,
    heartbeatCount,
    lastHeartbeatAt,
    errorMessage,
    retryCount,
    reconnect: connect,
    stop,
    refreshTaskInfo,
  };
}
