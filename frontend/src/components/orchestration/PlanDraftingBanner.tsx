import React from 'react';

interface PlanDraftingBannerProps {
  streamHint: string;
  streamConnected: boolean;
}

const PlanDraftingBanner: React.FC<PlanDraftingBannerProps> = ({ streamHint, streamConnected }) => {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p className="font-medium">任务生成中</p>
      <p className="mt-1 text-xs text-amber-700">
        {streamHint || '系统正在异步编排任务，任务会逐条显示在下方列表。'} {' · '}
        {streamConnected ? '实时连接已建立' : '实时连接重连中，已启用轮询兜底'}
      </p>
    </div>
  );
};

export default PlanDraftingBanner;
