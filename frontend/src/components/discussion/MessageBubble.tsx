import React from 'react';
import { DiscussionMessage, DiscussionParticipant } from '../../services/discussionService';

type MessageBubbleProps = {
  message: DiscussionMessage;
  participant?: DiscussionParticipant;
  onBranch: (message: DiscussionMessage) => void;
};

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, participant, onBranch }) => {
  const isUser = message.senderType === 'user';
  const isSystem = message.senderType === 'system';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
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
          <button
            type="button"
            onClick={() => onBranch(message)}
            className="text-xs text-[#0f62fe] hover:underline"
          >
            从此分叉
          </button>
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
      </div>
    </div>
  );
};

export default MessageBubble;
