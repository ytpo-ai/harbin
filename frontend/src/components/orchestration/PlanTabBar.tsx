import React from 'react';
import { PlanDetailTab } from './constants';

interface PlanTabBarProps {
  activeTab: PlanDetailTab;
  onChange: (tab: PlanDetailTab) => void;
}

const PlanTabBar: React.FC<PlanTabBarProps> = ({ activeTab, onChange }) => {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="inline-flex items-center gap-2">
        <button
          onClick={() => onChange('settings')}
          className={`rounded-md px-3 py-1.5 text-xs ${activeTab === 'settings' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          任务设置
        </button>
        <button
          onClick={() => onChange('history')}
          className={`rounded-md px-3 py-1.5 text-xs ${activeTab === 'history' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          执行历史
        </button>
      </div>
    </div>
  );
};

export default PlanTabBar;
