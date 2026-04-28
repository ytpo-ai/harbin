import React, { useMemo } from 'react';
import { DiscussionThread } from '../../services/discussionService';

type ThreadTreeProps = {
  threads: DiscussionThread[];
  selectedThreadId?: string;
  onSelect: (threadId: string) => void;
};

type ThreadNodeProps = {
  node: DiscussionThread;
  childrenMap: Record<string, DiscussionThread[]>;
  selectedThreadId?: string;
  onSelect: (threadId: string) => void;
};

const ThreadNode: React.FC<ThreadNodeProps> = ({ node, childrenMap, selectedThreadId, onSelect }) => {
  const children = childrenMap[node.id] || [];
  const isSelected = selectedThreadId === node.id;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={`w-full border-l-2 px-3 py-2 text-left transition ${
          isSelected
            ? 'border-[#0f62fe] bg-[#edf5ff] text-[#0f62fe]'
            : 'border-transparent text-[#262626] hover:border-[#8d8d8d] hover:bg-[#f4f4f4]'
        }`}
      >
        <div className="truncate text-sm font-medium">{node.title || '未命名讨论线'}</div>
        <div className="mt-1 text-xs text-[#6f6f6f]">{node.messageCount || 0} 条消息</div>
      </button>
      {children.length > 0 ? (
        <div className="ml-3 border-l border-[#e0e0e0] pl-1">
          {children.map((child) => (
            <ThreadNode
              key={child.id}
              node={child}
              childrenMap={childrenMap}
              selectedThreadId={selectedThreadId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const ThreadTree: React.FC<ThreadTreeProps> = ({ threads, selectedThreadId, onSelect }) => {
  const { roots, childrenMap } = useMemo(() => {
    const byParent: Record<string, DiscussionThread[]> = {};
    const rootNodes: DiscussionThread[] = [];

    for (const thread of threads) {
      if (!thread.parentThreadId) {
        rootNodes.push(thread);
        continue;
      }
      if (!byParent[thread.parentThreadId]) {
        byParent[thread.parentThreadId] = [];
      }
      byParent[thread.parentThreadId].push(thread);
    }

    for (const key of Object.keys(byParent)) {
      byParent[key] = byParent[key].sort((a, b) => a.title.localeCompare(b.title));
    }

    return {
      roots: rootNodes.sort((a, b) => a.depth - b.depth),
      childrenMap: byParent,
    };
  }, [threads]);

  if (threads.length === 0) {
    return <div className="px-3 py-6 text-sm text-[#6f6f6f]">暂无讨论线</div>;
  }

  return (
    <div className="space-y-1">
      {roots.map((thread) => (
        <ThreadNode
          key={thread.id}
          node={thread}
          childrenMap={childrenMap}
          selectedThreadId={selectedThreadId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};

export default ThreadTree;
