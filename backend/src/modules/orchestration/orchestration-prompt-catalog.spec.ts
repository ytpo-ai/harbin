import { ORCHESTRATION_PROMPTS } from './orchestration-prompt-catalog';

describe('orchestration-prompt-catalog', () => {
  it('ensures scene+role pair is unique', () => {
    const entries = Object.values(ORCHESTRATION_PROMPTS);
    const seen = new Set<string>();

    for (const entry of entries) {
      const key = `${entry.scene}::${entry.role}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('ensures each default content is non-empty', () => {
    const entries = Object.values(ORCHESTRATION_PROMPTS);
    for (const entry of entries) {
      const content = String(entry.buildDefaultContent() || '').trim();
      expect(content.length).toBeGreaterThan(0);
    }
  });
});
