import React from 'react';
import { DiscussionParticipant } from '../../services/discussionService';

type MessageInputProps = {
  value: string;
  sending: boolean;
  participants: DiscussionParticipant[];
  onChange: (value: string) => void;
  onSend: () => void;
};

const MessageInput: React.FC<MessageInputProps> = ({ value, sending, participants, onChange, onSend }) => {
  const mentionableParticipants = participants.filter((participant) => participant.type === 'ai_agent' || participant.role === 'on_demand');

  const appendMention = (displayName: string) => {
    const suffix = value.trimEnd().length > 0 ? ' ' : '';
    onChange(`${value}${suffix}@${displayName} `);
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="border-t border-[#c6c6c6] bg-white p-4">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息，支持 @参与者"
        rows={4}
        className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
      />

      {mentionableParticipants.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {mentionableParticipants.map((participant) => (
            <button
              key={participant.id}
              type="button"
              onClick={() => appendMention(participant.displayName)}
              className="border border-[#78a9ff] px-2 py-1 text-xs text-[#0f62fe] hover:bg-[#edf5ff]"
            >
              @{participant.displayName}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-[#6f6f6f]">支持 Ctrl/Cmd + Enter 发送</span>
        <button
          type="button"
          onClick={onSend}
          disabled={sending || !value.trim()}
          className="bg-[#0f62fe] px-4 py-2 text-sm text-white hover:bg-[#0353e9] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  );
};

export default MessageInput;
