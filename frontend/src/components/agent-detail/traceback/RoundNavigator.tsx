import React from 'react';

export interface RoundNavItem {
  round: number;
  hasDeduction: boolean;
  hasError: boolean;
}

interface RoundNavigatorProps {
  rounds: RoundNavItem[];
  activeRound: number;
  onSelectRound: (round: number) => void;
}

export const RoundNavigator: React.FC<RoundNavigatorProps> = ({ rounds, activeRound, onSelectRound }) => {
  return (
    <div className="w-14 shrink-0 border-r border-slate-200 px-2 py-3">
      <div className="space-y-2">
        {rounds.map((item, index) => {
          const dotClass = item.hasError ? 'bg-rose-500' : item.hasDeduction ? 'bg-amber-500' : 'bg-emerald-500';
          const active = activeRound === item.round;

          return (
            <button key={item.round} className="flex w-full items-center gap-1 text-left" onClick={() => onSelectRound(item.round)}>
              <span className={`h-2.5 w-2.5 rounded-full ${dotClass} ${active ? 'ring-2 ring-primary-300 ring-offset-1' : ''}`} />
              <span className={`text-[11px] ${active ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>R{item.round}</span>
              {item.hasDeduction && <span className="text-[10px] text-amber-600">⚠</span>}
              {index < rounds.length - 1 && <span className="h-3 w-px bg-slate-200" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
