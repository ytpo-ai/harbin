import { splitTextByMaxLength } from './agent.constants';

describe('agent.constants splitTextByMaxLength', () => {
  it('returns one chunk when content length is within max length', () => {
    expect(splitTextByMaxLength('abcd', 10)).toEqual(['abcd']);
  });

  it('splits long content into ordered chunks', () => {
    expect(splitTextByMaxLength('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('returns empty array for empty input', () => {
    expect(splitTextByMaxLength('', 4)).toEqual([]);
    expect(splitTextByMaxLength(undefined, 4)).toEqual([]);
  });
});
