import { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import {
  OrchestrationRun,
  OrchestrationRunTask,
  orchestrationService,
} from '../services/orchestrationService';
import { PlanDetailTab } from '../components/orchestration/constants';

export const usePlanRunHistory = (
  planId: string | undefined,
  activeTab: PlanDetailTab,
  runDrawerOpen: boolean,
  selectedRunId: string,
) => {
  const [runStatusFilter, setRunStatusFilter] = useState<'all' | 'running' | 'completed' | 'failed' | 'cancelled'>('all');
  const [runTriggerFilter, setRunTriggerFilter] = useState<'all' | 'manual' | 'schedule' | 'autorun'>('all');

  const {
    data: planRuns = [],
    isFetching: planRunsLoading,
    error: planRunsError,
  } = useQuery<OrchestrationRun[]>(
    ['orchestration-plan-runs', planId],
    () => orchestrationService.getPlanRuns(planId!, 50),
    {
      enabled: Boolean(planId) && activeTab === 'history',
      refetchInterval: (data) => {
        const hasRunning = (data as OrchestrationRun[] | undefined)?.some((item) => item.status === 'running');
        return hasRunning ? 3000 : false;
      },
    },
  );

  const {
    data: latestRun,
    isFetching: latestRunLoading,
  } = useQuery<OrchestrationRun | null>(
    ['orchestration-plan-latest-run', planId],
    () => orchestrationService.getPlanLatestRun(planId!),
    {
      enabled: Boolean(planId) && activeTab === 'history',
      refetchInterval: 5000,
    },
  );

  const {
    data: runDetail,
    isFetching: runDetailLoading,
    error: runDetailError,
  } = useQuery<OrchestrationRun>(
    ['orchestration-run-detail', selectedRunId],
    () => orchestrationService.getRunById(selectedRunId),
    {
      enabled: Boolean(selectedRunId) && runDrawerOpen,
      refetchInterval: (data) => {
        const status = (data as OrchestrationRun | undefined)?.status;
        return status === 'running' ? 3000 : false;
      },
    },
  );

  const {
    data: runTasks = [],
    isFetching: runTasksLoading,
    error: runTasksError,
  } = useQuery<OrchestrationRunTask[]>(
    ['orchestration-run-tasks', selectedRunId],
    () => orchestrationService.getRunTasks(selectedRunId),
    {
      enabled: Boolean(selectedRunId) && runDrawerOpen,
      refetchInterval: runDrawerOpen ? 3000 : false,
    },
  );

  const filteredPlanRuns = useMemo(() => {
    return planRuns.filter((run) => {
      const statusMatched = runStatusFilter === 'all' || run.status === runStatusFilter;
      const triggerMatched = runTriggerFilter === 'all' || run.triggerType === runTriggerFilter;
      return statusMatched && triggerMatched;
    });
  }, [planRuns, runStatusFilter, runTriggerFilter]);

  return {
    runStatusFilter,
    setRunStatusFilter,
    runTriggerFilter,
    setRunTriggerFilter,
    planRuns,
    planRunsLoading,
    planRunsError,
    latestRun,
    latestRunLoading,
    runDetail,
    runDetailLoading,
    runDetailError,
    runTasks,
    runTasksLoading,
    runTasksError,
    filteredPlanRuns,
  };
};
