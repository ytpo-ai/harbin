import React, { useEffect, useMemo, useState } from 'react';
import { MentionCandidate } from '../types';

type Params = {
  mentionCandidates: MentionCandidate[];
};

export const useMentionAutocomplete = ({ mentionCandidates }: Params) => {
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);

  const filteredMentionCandidates = useMemo(() => {
    if (mentionStart === null) {
      return [];
    }

    const normalizedQuery = mentionQuery.trim().toLowerCase();
    return mentionCandidates.filter((candidate) => {
      if (!normalizedQuery) {
        return true;
      }
      return candidate.name.toLowerCase().includes(normalizedQuery) || candidate.id.toLowerCase().includes(normalizedQuery);
    });
  }, [mentionCandidates, mentionQuery, mentionStart]);

  useEffect(() => {
    if (mentionStart === null) {
      return;
    }
    if (filteredMentionCandidates.length === 0) {
      setMentionActiveIndex(0);
      return;
    }
    if (mentionActiveIndex >= filteredMentionCandidates.length) {
      setMentionActiveIndex(0);
    }
  }, [filteredMentionCandidates.length, mentionActiveIndex, mentionStart]);

  const resetMention = () => {
    setMentionStart(null);
    setMentionQuery('');
    setMentionActiveIndex(0);
  };

  const updateMentionState = (value: string, caretPosition: number | null) => {
    if (caretPosition === null || caretPosition < 0) {
      resetMention();
      return;
    }

    const textBeforeCaret = value.slice(0, caretPosition);
    const atIndex = textBeforeCaret.lastIndexOf('@');
    if (atIndex === -1) {
      resetMention();
      return;
    }

    const prefix = textBeforeCaret.slice(Math.max(0, atIndex - 1), atIndex);
    if (prefix && !/\s|\(|\[|\{|\n/.test(prefix)) {
      resetMention();
      return;
    }

    const query = textBeforeCaret.slice(atIndex + 1);
    if (/\s/.test(query)) {
      resetMention();
      return;
    }

    setMentionStart(atIndex);
    setMentionQuery(query);
    setMentionActiveIndex(0);
  };

  const applyMentionCandidate = (
    candidate: MentionCandidate,
    value: string,
    inputRef: React.RefObject<HTMLTextAreaElement>,
    setValue: React.Dispatch<React.SetStateAction<string>>,
  ) => {
    if (!inputRef.current || mentionStart === null) {
      return;
    }

    const input = inputRef.current;
    const caretPosition = input.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(caretPosition);
    const mentionText = `@${candidate.name} `;
    const nextMessage = `${before}${mentionText}${after}`;
    const nextCaret = before.length + mentionText.length;

    setValue(nextMessage);
    resetMention();

    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
    });
  };

  return {
    mentionStart,
    mentionActiveIndex,
    filteredMentionCandidates,
    setMentionActiveIndex,
    resetMention,
    updateMentionState,
    applyMentionCandidate,
  };
};
