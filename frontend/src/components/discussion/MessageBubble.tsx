import React from 'react';
import { DiscussionKnowledgeEntry, DiscussionMessage, DiscussionParticipant } from '../../services/discussionService';

type MessageBubbleProps = {
  message: DiscussionMessage;
  participant?: DiscussionParticipant;
  onBranch: (message: DiscussionMessage) => void;
  onArchiveKnowledge: (message: DiscussionMessage) => void;
  onToRequirement: (message: DiscussionMessage) => void;
  generatedKnowledgeEntries?: DiscussionKnowledgeEntry[];
  deletingKnowledgeEntryId?: string;
  onDeleteGeneratedKnowledge?: (entry: DiscussionKnowledgeEntry) => void;
};

const entryTypeLabelMap: Record<string, string> = {
  fact: '事实',
  data_point: '数据点',
  opinion: '观点',
  source_reference: '来源',
  analysis: '分析',
  action_item: '行动项',
};

const credibilityLabelMap: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  unverified: '待验证',
};

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  participant,
  onBranch,
  onArchiveKnowledge,
  onToRequirement,
  generatedKnowledgeEntries = [],
  deletingKnowledgeEntryId,
  onDeleteGeneratedKnowledge,
}) => {
  const isUser = message.senderType === 'user';
  const isSystem = message.senderType === 'system';
  const searchEvidence = message.metadata?.searchEvidence || [];

  return (
    <div id={`message-${message.id}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[82%] border px-4 py-3 ${
          isUser
            ? 'border-[#0f62fe] bg-[#edf5ff]'
            : isSystem
              ? 'border-[#e0e0e0] bg-[#f4f4f4]'
              : 'border-[#c6c6c6] bg-white'
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-4">
          <div className="text-xs text-[#6f6f6f]">
            {participant?.displayName || message.senderType} · #{message.sequence}
          </div>
          <div className="flex items-center gap-3">
            {!isSystem ? (
              <button
                type="button"
                onClick={() => onArchiveKnowledge(message)}
                className="text-xs text-[#0f62fe] hover:underline"
              >
                落档知识库
              </button>
            ) : null}
            {!isSystem ? (
              <button
                type="button"
                onClick={() => onToRequirement(message)}
                className="text-xs text-[#0f62fe] hover:underline"
              >
                转为需求
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onBranch(message)}
              className="text-xs text-[#0f62fe] hover:underline"
            >
              从此分叉
            </button>
          </div>
        </div>

        <div className="whitespace-pre-wrap text-sm leading-6 text-[#161616]">{message.content}</div>

        {message.branchSuggestions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.branchSuggestions.map((suggestion) => (
              <span
                key={suggestion.id}
                className="border border-[#78a9ff] bg-[#edf5ff] px-2 py-1 text-xs text-[#0043ce]"
                title={suggestion.reason}
              >
                建议分支: {suggestion.topic}
              </span>
            ))}
          </div>
        ) : null}

        {message.crossReferences.length > 0 ? (
          <div className="mt-3 space-y-2 border-t border-[#e0e0e0] pt-2">
            {message.crossReferences.map((reference) => (
              <div key={`${reference.threadId}-${reference.messageId}`} className="bg-[#f4f4f4] p-2 text-xs">
                <div className="text-[#0f62fe]">引用: {reference.threadTitle}</div>
                <div className="mt-1 text-[#525252]">{reference.summary}</div>
              </div>
            ))}
          </div>
        ) : null}

        {(message.dataReferences || []).length > 0 ? (
          <div className="mt-3 space-y-2 border-t border-[#e0e0e0] pt-2">
            {(message.dataReferences || []).map((reference) => (
              <details key={reference.dataRecordId} className="bg-[#f4f4f4] p-2 text-xs text-[#161616]">
                <summary className="cursor-pointer text-[#0f62fe]">数据引用: {reference.dataSourceName}</summary>
                <div className="mt-1 text-[#525252]">{reference.dataPreview}</div>
                <div className="mt-1 text-[11px] text-[#6f6f6f]">采集时间: {new Date(reference.collectedAt).toLocaleString()}</div>
              </details>
            ))}
          </div>
        ) : null}

        {searchEvidence.length > 0 ? (
          <div className="mt-3 space-y-2 border-t border-[#e0e0e0] pt-2">
            <details className="bg-[#f4f4f4] p-2 text-xs text-[#161616]">
              <summary className="cursor-pointer text-[#0f62fe]">本轮检索来源 ({searchEvidence.length})</summary>
              <div className="mt-2 space-y-2">
                {searchEvidence.map((item, index) => (
                  <div key={`${item.sourceUrl}-${index}`} className="border border-[#e0e0e0] bg-white p-2">
                    <div className="font-medium text-[#0f62fe]">{item.sourceName || '未命名来源'}</div>
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-[#0f62fe] hover:underline">
                      {item.sourceUrl}
                    </a>
                    {item.snippet ? <div className="mt-1 text-[#525252]">{item.snippet}</div> : null}
                    <div className="mt-1 text-[11px] text-[#6f6f6f]">
                      {item.query ? `查询词: ${item.query}` : ''}
                      {item.query && item.fetchedAt ? ' · ' : ''}
                      {item.fetchedAt ? `抓取时间: ${new Date(item.fetchedAt).toLocaleString()}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ) : null}

        {generatedKnowledgeEntries.length > 0 ? (
          <div className="mt-3 space-y-2 border-t border-[#e0e0e0] pt-2">
            {generatedKnowledgeEntries.map((entry) => (
              <div key={entry.id} className="border border-[#d0e2ff] bg-[#edf5ff] p-2 text-xs text-[#161616]">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-[#0f62fe]">{entry.title}</div>
                  {onDeleteGeneratedKnowledge ? (
                    <button
                      type="button"
                      onClick={() => onDeleteGeneratedKnowledge(entry)}
                      disabled={deletingKnowledgeEntryId === entry.id}
                      className="text-[#8d1f1f] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingKnowledgeEntryId === entry.id ? '删除中...' : '删除'}
                    </button>
                  ) : null}
                </div>
                <div className="mt-1 text-[#525252]">
                  类型：{entryTypeLabelMap[String(entry.entryType || '')] || entry.entryType || '未分类'} · 可信度：
                  {credibilityLabelMap[String(entry.credibility || '')] || entry.credibility || '未标注'}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default MessageBubble;
