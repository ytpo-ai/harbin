import React from 'react';
import PlanHeader from './PlanHeader';
import PlanDetailMainContent from './PlanDetailMainContent';
import PlanDetailTaskOverlays from './PlanDetailTaskOverlays';
import PlanDetailRuntimeOverlays from './PlanDetailRuntimeOverlays';

interface PlanDetailScaffoldProps {
  headerProps: React.ComponentProps<typeof PlanHeader>;
  mainContentProps: React.ComponentProps<typeof PlanDetailMainContent>;
  taskOverlayProps: React.ComponentProps<typeof PlanDetailTaskOverlays>;
  runtimeOverlayProps: React.ComponentProps<typeof PlanDetailRuntimeOverlays>;
}

const PlanDetailScaffold: React.FC<PlanDetailScaffoldProps> = ({
  headerProps,
  mainContentProps,
  taskOverlayProps,
  runtimeOverlayProps,
}) => {
  return (
    <div className="min-h-screen bg-slate-50">
      <PlanHeader {...headerProps} />
      <PlanDetailMainContent {...mainContentProps} />
      <PlanDetailTaskOverlays {...taskOverlayProps} />
      <PlanDetailRuntimeOverlays {...runtimeOverlayProps} />
    </div>
  );
};

export default PlanDetailScaffold;
