import React, { useEffect, useMemo, useState } from 'react';
import { PhraseSuggestion } from '../types';

type Params = {
  phraseSuggestions: PhraseSuggestion[];
};

export const usePhraseAutocomplete = ({ phraseSuggestions }: Params) => {
  const [phraseStart, setPhraseStart] = useState<number | null>(null);
  const [phraseQuery, setPhraseQuery] = useState('');
  const [phraseActiveIndex, setPhraseActiveIndex] = useState(0);

  const filteredPhraseSuggestions = useMemo(() => {
    if (phraseStart === null) {
      return [];
    }

    const normalizedQuery = phraseQuery.trim().toLowerCase();
    return phraseSuggestions.filter((item) => {
      if (!normalizedQuery) {
        return true;
      }
      const searchText = `${item.label} ${item.command}`.toLowerCase();
      return searchText.includes(normalizedQuery);
    });
  }, [phraseQuery, phraseStart, phraseSuggestions]);

  useEffect(() => {
    if (phraseStart === null) {
      return;
    }
    if (filteredPhraseSuggestions.length === 0) {
      setPhraseActiveIndex(0);
      return;
    }
    if (phraseActiveIndex >= filteredPhraseSuggestions.length) {
      setPhraseActiveIndex(0);
    }
  }, [filteredPhraseSuggestions.length, phraseActiveIndex, phraseStart]);

  const resetPhrase = () => {
    setPhraseStart(null);
    setPhraseQuery('');
    setPhraseActiveIndex(0);
  };

  const updatePhraseState = (value: string, caretPosition: number | null) => {
    if (caretPosition === null || caretPosition < 0) {
      resetPhrase();
      return;
    }

    const textBeforeCaret = value.slice(0, caretPosition);
    const leftBracketIndex = Math.max(textBeforeCaret.lastIndexOf('['), textBeforeCaret.lastIndexOf('【'));
    if (leftBracketIndex === -1) {
      resetPhrase();
      return;
    }

    const textAfterBracket = textBeforeCaret.slice(leftBracketIndex + 1);
    if (textAfterBracket.includes(']') || textAfterBracket.includes('】') || /\n/.test(textAfterBracket)) {
      resetPhrase();
      return;
    }

    setPhraseStart(leftBracketIndex);
    setPhraseQuery(textAfterBracket);
    setPhraseActiveIndex(0);
  };

  const applyPhraseSuggestion = (
    suggestion: PhraseSuggestion,
    value: string,
    inputRef: React.RefObject<HTMLTextAreaElement>,
    setValue: React.Dispatch<React.SetStateAction<string>>,
  ) => {
    if (!inputRef.current || phraseStart === null) {
      return;
    }

    const input = inputRef.current;
    const caretPosition = input.selectionStart ?? value.length;
    const before = value.slice(0, phraseStart);
    const after = value.slice(caretPosition);
    const phraseText = `${suggestion.command} `;
    const nextMessage = `${before}${phraseText}${after}`;
    const nextCaret = before.length + phraseText.length;

    setValue(nextMessage);
    resetPhrase();

    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
    });
  };

  return {
    phraseStart,
    phraseActiveIndex,
    filteredPhraseSuggestions,
    setPhraseActiveIndex,
    resetPhrase,
    updatePhraseState,
    applyPhraseSuggestion,
  };
};
