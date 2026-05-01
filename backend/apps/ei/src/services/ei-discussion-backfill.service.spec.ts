import { calcChangePercent, extractPrimaryNumericValue } from './ei-discussion-backfill.service';

describe('EiDiscussionBackfillService helpers', () => {
  it('extracts preferred numeric value field', () => {
    expect(extractPrimaryNumericValue({ value: 123, unit: 'USD' })).toBe(123);
  });

  it('falls back to first numeric field when value is absent', () => {
    expect(extractPrimaryNumericValue({ foo: 'x', bar: 42, baz: '12' })).toBe(42);
  });

  it('returns null for non numeric data', () => {
    expect(extractPrimaryNumericValue({ foo: 'x', bar: 'y' })).toBeNull();
  });

  it('calculates percentage delta against previous baseline', () => {
    expect(calcChangePercent(150, 100)).toBeCloseTo(50, 6);
    expect(calcChangePercent(80, 100)).toBeCloseTo(-20, 6);
  });

  it('returns null when baseline is missing or zero', () => {
    expect(calcChangePercent(120, null)).toBeNull();
    expect(calcChangePercent(120, 0)).toBeNull();
  });
});
