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

describe('OpenCodeAdapter session activity detection', () => {
  it('treats session payload with unknown state as active', async () => {
    const adapter = new OpenCodeAdapter({ get: jest.fn() } as any);
    jest.spyOn(adapter as any, 'request').mockResolvedValue({ id: 'ses-1' });

    const status = await adapter.getSessionStatus('ses-1');

    expect(status.active).toBe(true);
  });

  it('treats terminal session state as inactive', async () => {
    const adapter = new OpenCodeAdapter({ get: jest.fn() } as any);
    jest.spyOn(adapter as any, 'request').mockResolvedValue({ id: 'ses-1', status: 'completed' });

    const status = await adapter.getSessionStatus('ses-1');

    expect(status.active).toBe(false);
  });

  it('treats latest non-assistant running message as active', async () => {
    const adapter = new OpenCodeAdapter({ get: jest.fn() } as any);
    jest.spyOn(adapter as any, 'request').mockResolvedValue({
      id: 'ses-1',
      messages: [
        { role: 'user', status: 'completed' },
        { role: 'tool', status: 'running' },
      ],
    });

    const status = await adapter.getSessionStatus('ses-1');

    expect(status.active).toBe(true);
  });
});
