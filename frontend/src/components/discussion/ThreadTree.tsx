import React, { useMemo } from 'react';
import { DiscussionThread } from '../../services/discussionService';

type ThreadTreeProps = {
  threads: DiscussionThread[];
  rootThreadId?: string;
  selectedThreadId?: string;
  onSelect: (threadId: string) => void;
  onDelete?: (thread: DiscussionThread) => void;
};

type ThreadNodeProps = {
  node: DiscussionThread;
  rootThreadId?: string;
  childrenMap: Record<string, DiscussionThread[]>;
  selectedThreadId?: string;
  onSelect: (threadId: string) => void;
  onDelete?: (thread: DiscussionThread) => void;
};

const ThreadNode: React.FC<ThreadNodeProps> = ({ node, rootThreadId, childrenMap, selectedThreadId, onSelect, onDelete }) => {
  const children = childrenMap[node.id] || [];
  const isSelected = selectedThreadId === node.id;
  const canDelete = Boolean(onDelete && node.id !== rootThreadId);

  return (
    <div>
      <div
        className={`flex items-start gap-2 border-l-2 px-3 py-2 transition ${
          isSelected
            ? 'border-[#0f62fe] bg-[#edf5ff] text-[#0f62fe]'
            : 'border-transparent text-[#262626] hover:border-[#8d8d8d] hover:bg-[#f4f4f4]'
        }`}
      >
        <button type="button" onClick={() => onSelect(node.id)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <div className="truncate text-sm font-medium">{node.title || '未命名讨论线'}</div>
            {node.outlineSectionId ? (
              <span className="shrink-0 border border-[#8a3ffc] bg-[#f6f2ff] px-1 py-0 text-[10px] text-[#6929c4]">
                章节
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-[#6f6f6f]">{node.messageCount || 0} 条消息</div>
        </button>
        {canDelete ? (
          <button
            type="button"
            onClick={() => onDelete?.(node)}
            className="shrink-0 border border-[#c6c6c6] px-1.5 py-0.5 text-[11px] text-[#8d1f1f] hover:bg-[#fff1f1]"
          >
            删除
          </button>
        ) : null}
      </div>
      {children.length > 0 ? (
        <div className="ml-3 border-l border-[#e0e0e0] pl-1">
          {children.map((child) => (
            <ThreadNode
              key={child.id}
              node={child}
              rootThreadId={rootThreadId}
              childrenMap={childrenMap}
              selectedThreadId={selectedThreadId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const ThreadTree: React.FC<ThreadTreeProps> = ({ threads, rootThreadId, selectedThreadId, onSelect, onDelete }) => {
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
          rootThreadId={rootThreadId}
          childrenMap={childrenMap}
          selectedThreadId={selectedThreadId}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};

export default ThreadTree;
