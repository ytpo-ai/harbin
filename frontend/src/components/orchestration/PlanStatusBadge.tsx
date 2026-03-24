import React from 'react';
import { STATUS_COLOR } from './constants';

interface PlanStatusBadgeProps {
  status: string;
}

const PlanStatusBadge: React.FC<PlanStatusBadgeProps> = ({ status }) => {
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[status] || STATUS_COLOR.pending}`}>
      {status}
    </span>
  );
};

export default PlanStatusBadge;
