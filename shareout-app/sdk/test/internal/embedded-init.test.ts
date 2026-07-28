import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPostMessageData,
  setPostMessageData,
  waitForPostMessageInit,
  type EmbeddedInitialData,
} from '../../src/internal/embedded-init';

const sampleData: EmbeddedInitialData = {
  artifactId: 'art_embedded',
  baseUrl: 'https://embed.example.com',
  json: { settings: { theme: 'dark' } },
};

afterEach(() => {
  setPostMessageData(null as unknown as EmbeddedInitialData);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('embedded-init', () => {
  it('stores and retrieves postMessage data', () => {
    setPostMessageData(sampleData);
    expect(getPostMessageData()).toEqual(sampleData);
  });

  it('returns immediately in node (no window)', async () => {
    await expect(waitForPostMessageInit()).resolves.toBeUndefined();
  });

  it('returns immediately when not in an iframe', async () => {
    vi.stubGlobal('window', {
      parent: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    Object.defineProperty(window, 'parent', { value: window, configurable: true });

    await expect(waitForPostMessageInit()).resolves.toBeUndefined();
  });

  it('returns immediately when data is already set', async () => {
    setPostMessageData(sampleData);
    vi.stubGlobal('window', {
      parent: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
    });
    Object.defineProperty(window, 'parent', { value: {}, configurable: true });

    await expect(waitForPostMessageInit()).resolves.toBeUndefined();
  });

  it('waits for shareout:init message in iframe', async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (event: MessageEvent) => void>();
    const parentPostMessage = vi.fn();

    vi.stubGlobal('window', {
      parent: { postMessage: parentPostMessage },
      addEventListener: vi.fn((type: string, handler: (event: MessageEvent) => void) => {
        listeners.set(type, handler);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    });
    Object.defineProperty(window, 'parent', { value: { postMessage: parentPostMessage }, configurable: true });

    const waitPromise = waitForPostMessageInit(500);
    expect(parentPostMessage).toHaveBeenCalledWith({ type: 'shareout:ready' }, '*');

    listeners.get('message')?.({
      data: { type: 'shareout:init', data: sampleData },
    } as MessageEvent);

    await expect(waitPromise).resolves.toBeUndefined();
    expect(getPostMessageData()).toEqual(sampleData);
  });
});
