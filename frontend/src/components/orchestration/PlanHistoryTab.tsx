import React from 'react';
import { OrchestrationRun } from '../../services/orchestrationService';
import LatestRunCard from './LatestRunCard';
import RunHistoryList from './RunHistoryList';

interface PlanHistoryTabProps {
  latestRunSummary: OrchestrationRun | null;
  latestRunLoading: boolean;
  filteredPlanRuns: OrchestrationRun[];
  planRunsLoading: boolean;
  planRunsError: boolean;
  runTriggerFilter: 'all' | 'manual' | 'schedule' | 'autorun';
  runStatusFilter: 'all' | 'running' | 'completed' | 'failed' | 'cancelled';
  cancelRunLoading: boolean;
  onChangeTriggerFilter: (value: 'all' | 'manual' | 'schedule' | 'autorun') => void;
  onChangeStatusFilter: (value: 'all' | 'running' | 'completed' | 'failed' | 'cancelled') => void;
  onOpenRunDetail: (runId: string) => void;
  onCancelRun: (runId: string) => void;
}

const PlanHistoryTab: React.FC<PlanHistoryTabProps> = ({
  latestRunSummary,
  latestRunLoading,
  filteredPlanRuns,
  planRunsLoading,
  planRunsError,
  runTriggerFilter,
  runStatusFilter,
  cancelRunLoading,
  onChangeTriggerFilter,
  onChangeStatusFilter,
  onOpenRunDetail,
  onCancelRun,
}) => {
  return (
    <div className="space-y-4">
      <LatestRunCard
        latestRunSummary={latestRunSummary}
        loading={latestRunLoading}
        onOpenRunDetail={onOpenRunDetail}
      />
      <RunHistoryList
        runs={filteredPlanRuns}
        loading={planRunsLoading}
        hasError={planRunsError}
        runTriggerFilter={runTriggerFilter}
        runStatusFilter={runStatusFilter}
        isCancelling={cancelRunLoading}
        onChangeTriggerFilter={onChangeTriggerFilter}
        onChangeStatusFilter={onChangeStatusFilter}
        onOpenRunDetail={onOpenRunDetail}
        onCancelRun={onCancelRun}
      />
    </div>
  );
};

export default PlanHistoryTab;
