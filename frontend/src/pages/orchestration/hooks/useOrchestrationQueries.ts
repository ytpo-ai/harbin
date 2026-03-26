import { useMemo } from 'react';
import { useQuery } from 'react-query';
import { agentService } from '../../../services/agentService';
import { employeeService } from '../../../services/employeeService';
import {
  orchestrationService,
  OrchestrationPlan,
  OrchestrationRun,
  OrchestrationRunTask,
} from '../../../services/orchestrationService';
import { FULLY_EDITABLE_PLAN_STATUS, PlanDrawerTab, RunStatusFilter, RunTriggerFilter } from '../constants';

type Params = {
  selectedPlanId: string;
  selectedRunId: string;
  debugSessionId: string;
  debugTaskId: string;
  debugDrawerOpen: boolean;
  runDetailDrawerOpen: boolean;
  isDetailDrawerOpen: boolean;
  activePlanDrawerTab: PlanDrawerTab;
  runStatusFilter: RunStatusFilter;
  runTriggerFilter: RunTriggerFilter;
};

export const useOrchestrationQueries = ({
  selectedPlanId,
  selectedRunId,
  debugSessionId,
  debugTaskId,
  debugDrawerOpen,
  runDetailDrawerOpen,
  isDetailDrawerOpen,
  activePlanDrawerTab,
  runStatusFilter,
  runTriggerFilter,
}: Params) => {
  const { data: plans = [], isLoading: plansLoading } = useQuery<OrchestrationPlan[]>(
    'orchestration-plans',
    () => orchestrationService.getPlans(),
    { refetchInterval: 3000 },
  );

  const { data: planDetail, isFetching: planDetailLoading } = useQuery(
    ['orchestration-plan', selectedPlanId],
    () => orchestrationService.getPlanById(selectedPlanId),
    {
      enabled: Boolean(selectedPlanId) && isDetailDrawerOpen,
      refetchInterval: (data) => {
        if (!selectedPlanId || !isDetailDrawerOpen) {
          return false;
        }
        const status = (data as any)?.status as string | undefined;
        if (!status) {
          return false;
        }
        if (status === 'drafting') {
          return 2500;
        }
        if (status === 'planned' || status === 'draft') {
          return false;
        }
        return false;
      },
    },
  );

  const {
    data: planRuns = [],
    isFetching: planRunsLoading,
    error: planRunsError,
  } = useQuery<OrchestrationRun[]>(
    ['orchestration-plan-runs', selectedPlanId],
    () => orchestrationService.getPlanRuns(selectedPlanId, 50),
    {
      enabled: Boolean(selectedPlanId) && isDetailDrawerOpen && activePlanDrawerTab === 'history',
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
    ['orchestration-plan-latest-run', selectedPlanId],
    () => orchestrationService.getPlanLatestRun(selectedPlanId),
    {
      enabled: Boolean(selectedPlanId) && isDetailDrawerOpen && activePlanDrawerTab === 'history',
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
      enabled: Boolean(selectedRunId) && runDetailDrawerOpen,
      refetchInterval: (data) => ((data as OrchestrationRun | undefined)?.status === 'running' ? 3000 : false),
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
      enabled: Boolean(selectedRunId) && runDetailDrawerOpen,
      refetchInterval: runDetailDrawerOpen ? 3000 : false,
    },
  );

  const debugTask = useMemo(
    () => planDetail?.tasks?.find((task) => task._id === debugTaskId),
    [planDetail?.tasks, debugTaskId],
  );
  const planTasks = planDetail?.tasks ?? [];

  const isPlanEditable = useMemo(
    () => Boolean(planDetail?.status && FULLY_EDITABLE_PLAN_STATUS.has(planDetail.status)),
    [planDetail?.status],
  );

  const filteredPlanRuns = useMemo(() => {
    return planRuns.filter((run) => {
      const statusMatched = runStatusFilter === 'all' || run.status === runStatusFilter;
      const triggerMatched = runTriggerFilter === 'all' || run.triggerType === runTriggerFilter;
      return statusMatched && triggerMatched;
    });
  }, [planRuns, runStatusFilter, runTriggerFilter]);

  const latestRunSummary = latestRun ?? planDetail?.lastRun ?? null;

  const { data: debugSessionDetail, isFetching: debugSessionLoading } = useQuery(
    ['orchestration-debug-session', debugSessionId],
    () => orchestrationService.getSessionById(debugSessionId),
    {
      enabled: debugDrawerOpen && Boolean(debugSessionId),
      refetchInterval: debugDrawerOpen && debugSessionId ? 3000 : false,
    },
  );

  const { data: agents = [] } = useQuery('orchestration-agents', () => agentService.getAssignableAgents());
  const { data: employees = [] } = useQuery('orchestration-employees', () => employeeService.getEmployees());

  return {
    plans,
    plansLoading,
    planDetail,
    planDetailLoading,
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
    debugTask,
    planTasks,
    isPlanEditable,
    filteredPlanRuns,
    latestRunSummary,
    debugSessionDetail,
    debugSessionLoading,
    agents,
    employees,
  };
};
