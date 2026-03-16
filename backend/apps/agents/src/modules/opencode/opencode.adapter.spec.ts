import { OpenCodeAdapter } from './opencode.adapter';

describe('OpenCodeAdapter response extraction', () => {
  it('extracts text from top-level parts', () => {
    const adapter = new OpenCodeAdapter({ get: jest.fn() } as any);
    const text = adapter['extractResponseText']({
      parts: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }],
    });
    expect(text).toBe('hello world');
  });

  it('extracts text from info.parts', () => {
    const adapter = new OpenCodeAdapter({ get: jest.fn() } as any);
    const text = adapter['extractResponseText']({
      info: {
        parts: [{ type: 'text', text: 'foo' }, { type: 'text', text: 'bar' }],
      },
    });
    expect(text).toBe('foobar');
  });
});
