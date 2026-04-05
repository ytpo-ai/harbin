import React from 'react';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { ChatInputProps } from '../types';

const ChatInput: React.FC<ChatInputProps> = ({
  meeting,
  newMessage,
  setNewMessage,
  isComposing,
  setIsComposing,
  currentUserId,
  mentionHook,
  phraseHook,
  historyHook,
  inputRef,
  isSendingMessage,
  onSendMessage,
}) => {
  const canSpeak = Boolean(
    currentUserId &&
      (meeting.participants || []).some(
        (participant) =>
          participant.participantType === 'employee' && participant.participantId === currentUserId && participant.isPresent,
      ),
  );

  if (!canSpeak) {
    return (
      <div className="bg-white border-t border-gray-200 px-6 py-4 text-center">
        <p className="text-sm text-amber-700">你当前不在会议中，暂不可发言。</p>
      </div>
    );
  }

  const syncAutocomplete = (value: string, selectionStart: number | null) => {
    mentionHook.updateMentionState(value, selectionStart);
    phraseHook.updatePhraseState(value, selectionStart);
  };

  return (
    <div className="bg-white border-t border-gray-200 px-6 py-4">
      <div className="relative">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={newMessage}
            onChange={(event) => {
              if (historyHook.messageHistoryIndex !== null) {
                historyHook.resetHistoryState();
              }
              setNewMessage(event.target.value);
              if (!isComposing) {
                syncAutocomplete(event.target.value, event.target.selectionStart);
              }
            }}
            onClick={(event) => {
              syncAutocomplete(newMessage, event.currentTarget.selectionStart);
            }}
            onKeyUp={(event) => {
              if (!isComposing) {
                syncAutocomplete(newMessage, event.currentTarget.selectionStart);
              }
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={(event) => {
              setIsComposing(false);
              syncAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart);
            }}
            onKeyDown={(event) => {
              if (phraseHook.phraseStart !== null && phraseHook.filteredPhraseSuggestions.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  phraseHook.setPhraseActiveIndex((prev) => (prev + 1) % phraseHook.filteredPhraseSuggestions.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  phraseHook.setPhraseActiveIndex(
                    (prev) => (prev - 1 + phraseHook.filteredPhraseSuggestions.length) % phraseHook.filteredPhraseSuggestions.length,
                  );
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  phraseHook.applyPhraseSuggestion(
                    phraseHook.filteredPhraseSuggestions[phraseHook.phraseActiveIndex],
                    newMessage,
                    inputRef,
                    setNewMessage,
                  );
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  phraseHook.resetPhrase();
                  return;
                }
              }

              if (mentionHook.mentionStart !== null && mentionHook.filteredMentionCandidates.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  mentionHook.setMentionActiveIndex((prev) => (prev + 1) % mentionHook.filteredMentionCandidates.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  mentionHook.setMentionActiveIndex(
                    (prev) => (prev - 1 + mentionHook.filteredMentionCandidates.length) % mentionHook.filteredMentionCandidates.length,
                  );
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  mentionHook.applyMentionCandidate(
                    mentionHook.filteredMentionCandidates[mentionHook.mentionActiveIndex],
                    newMessage,
                    inputRef,
                    setNewMessage,
                  );
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  mentionHook.resetMention();
                  return;
                }
              }

              if (event.key === 'ArrowUp' && historyHook.sentMessageHistory.length > 0) {
                event.preventDefault();
                const nextContent = historyHook.navigateUp(newMessage);
                setNewMessage(nextContent);
                mentionHook.resetMention();
                phraseHook.resetPhrase();
                requestAnimationFrame(() => {
                  const input = inputRef.current;
                  if (!input) {
                    return;
                  }
                  input.focus();
                  input.setSelectionRange(nextContent.length, nextContent.length);
                });
                return;
              }

              if (event.key === 'ArrowDown' && historyHook.messageHistoryIndex !== null) {
                event.preventDefault();
                const nextContent = historyHook.navigateDown();
                setNewMessage(nextContent);
                mentionHook.resetMention();
                phraseHook.resetPhrase();
                requestAnimationFrame(() => {
                  const input = inputRef.current;
                  if (!input) {
                    return;
                  }
                  input.focus();
                  input.setSelectionRange(nextContent.length, nextContent.length);
                });
                return;
              }

              if (event.key === 'Enter' && !event.shiftKey && !isComposing && newMessage.trim()) {
                event.preventDefault();
                onSendMessage(newMessage);
                mentionHook.resetMention();
                phraseHook.resetPhrase();
              }
            }}
            placeholder="输入消息（输入 @ 点名；输入 [ 或 【 选择短语命令）..."
            rows={2}
            disabled={!canSpeak}
            className="flex-1 resize-none border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            onClick={() => {
              if (newMessage.trim()) {
                onSendMessage(newMessage);
                mentionHook.resetMention();
                phraseHook.resetPhrase();
              }
            }}
            disabled={isSendingMessage || !newMessage.trim() || !canSpeak}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PaperAirplaneIcon className="h-5 w-5" />
          </button>
        </div>

        {phraseHook.phraseStart !== null && phraseHook.filteredPhraseSuggestions.length > 0 && (
          <div className="absolute z-20 bottom-full mb-2 left-0 w-80 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {phraseHook.filteredPhraseSuggestions.map((item, index) => (
              <button
                key={`${item.key}:${item.command}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  phraseHook.applyPhraseSuggestion(item, newMessage, inputRef, setNewMessage);
                }}
                className={`w-full text-left px-3 py-2 text-sm ${
                  index === phraseHook.phraseActiveIndex ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                <div className="font-medium truncate">{item.label}</div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">{item.command}</div>
              </button>
            ))}
          </div>
        )}

        {mentionHook.mentionStart !== null && mentionHook.filteredMentionCandidates.length > 0 && (
          <div className="absolute z-20 bottom-full mb-2 left-0 w-72 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {mentionHook.filteredMentionCandidates.map((candidate, index) => (
              <button
                key={`${candidate.type}:${candidate.id}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  mentionHook.applyMentionCandidate(candidate, newMessage, inputRef, setNewMessage);
                }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                  index === mentionHook.mentionActiveIndex ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                <span className="truncate">{candidate.name}</span>
                <span className="text-xs text-gray-400 ml-2">{candidate.type === 'agent' ? 'Agent' : '成员'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
