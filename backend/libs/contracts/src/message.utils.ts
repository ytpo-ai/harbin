import { ContentPart, TextContentPart } from './model.types';

/**
 * Extracts text from a ChatMessage content value.
 * If `content` is already a string, returns it as-is.
 * If `content` is a ContentPart[], concatenates all text parts.
 */
export function extractTextContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is TextContentPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
