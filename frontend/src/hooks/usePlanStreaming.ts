import { useEffect, useRef } from 'react';
import { useQueryClient } from 'react-query';
import { OrchestrationPlan, orchestrationService } from '../services/orchestrationService';

interface UsePlanStreamingOptions {
  planId?: string;
  isReplanPending: boolean;
  lastAsyncReplanError: string;
  planDetail?: OrchestrationPlan;
  setStreamConnected: (value: boolean) => void;
  setStreamTaskIds: (value: string[] | ((prev: string[]) => string[])) => void;
  setStreamHint: (value: string) => void;
  setPromptHint: (value: string) => void;
  setIsReplanPending: (value: boolean) => void;
  refreshPlanData: () => Promise<void>;
}

export const usePlanStreaming = ({
  planId,
  isReplanPending,
  lastAsyncReplanError,
  planDetail,
  setStreamConnected,
  setStreamTaskIds,
  setStreamHint,
  setPromptHint,
  setIsReplanPending,
  refreshPlanData,
}: UsePlanStreamingOptions) => {
  const queryClient = useQueryClient();
  const isReplanPendingRef = useRef(isReplanPending);
  const refreshPlanDataRef = useRef(refreshPlanData);

  useEffect(() => {
    isReplanPendingRef.current = isReplanPending;
  }, [isReplanPending]);

  useEffect(() => {
    refreshPlanDataRef.current = refreshPlanData;
  }, [refreshPlanData]);

  useEffect(() => {
    if (!planId) {
      return;
    }

    let disposed = false;
    const unsubscribe = orchestrationService.subscribePlanEvents(planId, {
      onEvent: (event) => {
        if (disposed || !event?.type) {
          return;
        }
        setStreamConnected(true);
        if (event.type === 'plan.task.generated') {
          const generatedTaskId = String((event.data?.task?._id || '')).trim();
          if (generatedTaskId) {
            setStreamTaskIds((prev) => (prev.includes(generatedTaskId) ? prev : [...prev, generatedTaskId]));
          }
          setStreamHint(`正在生成任务 (${event.data?.index || 0}/${event.data?.total || '-'})`);
          if (isReplanPendingRef.current) {
            setPromptHint(`重新编排任务生成中 (${event.data?.index || 0}/${event.data?.total || '-'})`);
          }
          void queryClient.invalidateQueries(['orchestration-plan', planId]);
          return;
        }

        if (event.type === 'plan.completed') {
          setStreamHint('任务生成完成');
          if (isReplanPendingRef.current) {
            setIsReplanPending(false);
            setPromptHint('重新编排已完成，任务结构已覆盖更新');
          }
          void refreshPlanDataRef.current();
          return;
        }

        if (event.type === 'plan.failed') {
          setStreamHint(`任务生成失败: ${event.data?.error || 'unknown error'}`);
          if (isReplanPendingRef.current) {
            setIsReplanPending(false);
            setPromptHint(`重新编排失败：${event.data?.error || 'unknown error'}`);
          }
          void queryClient.invalidateQueries(['orchestration-plan', planId]);
          return;
        }

        if (event.type === 'plan.status.changed' && event.data?.status === 'drafting') {
          setStreamHint('任务生成中...');
          if (isReplanPendingRef.current) {
            setPromptHint('重新编排中：已清空旧任务，正在流式生成新任务...');
          }
        }
      },
      onError: () => {
        if (disposed) {
          return;
        }
        setStreamConnected(false);
      },
    });

    return () => {
      disposed = true;
      setStreamConnected(false);
      unsubscribe();
    };
  }, [
    planId,
    queryClient,
    setIsReplanPending,
    setPromptHint,
    setStreamConnected,
    setStreamHint,
    setStreamTaskIds,
  ]);

  useEffect(() => {
    if (!isReplanPending || !planDetail) {
      return;
    }

    const currentAsyncError = String(planDetail.metadata?.asyncReplanError || '');
    if (currentAsyncError && currentAsyncError !== lastAsyncReplanError) {
      setIsReplanPending(false);
      setPromptHint(`重新编排失败：${currentAsyncError}`);
      return;
    }

    if (planDetail.status === 'planned') {
      setIsReplanPending(false);
      setPromptHint('重新编排已完成，任务结构已覆盖更新');
      void refreshPlanData();
      return;
    }

    if (planDetail.status === 'drafting' && (planDetail.stats?.totalTasks || 0) === 0) {
      setPromptHint('重新编排中：旧任务已删除，等待新任务生成...');
    }
  }, [
    isReplanPending,
    lastAsyncReplanError,
    planDetail,
    refreshPlanData,
    setIsReplanPending,
    setPromptHint,
  ]);
};
