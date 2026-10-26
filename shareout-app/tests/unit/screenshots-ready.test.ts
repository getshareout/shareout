// The capture wait races window.__shareoutReady against network idle, so a page that
// never sets the flag no longer burns the whole idleTimeout (12 s for thumbnails),
// while a page that takes part in the protocol is still waited on until it is ready.
// Virtual time: puppeteer is mocked and every wait is a fake timer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import puppeteer from '@cloudflare/puppeteer';
import { generateArtifactThumbnail, waitForArtifactReady } from '../../src/screenshots';
import type { Env } from '../../src/types';

vi.mock('@cloudflare/puppeteer', () => ({ default: { launch: vi.fn() } }));
// Keep every step on the fake clock: real HMAC signing would resolve outside it.
vi.mock('../../src/token', () => ({ createAccessToken: async () => 'capture-token' }));

const IDLE_MS = 1000; // waitForNetworkIdle idleTime
const THUMB_SETTLE_MS = 1500;
const THUMB_TIMEOUT_MS = 12_000;
const CARD_PAUSE_MS = 200;

/** A page whose network goes idle after IDLE_MS and that sets the ready flag at `flagAt` (null = never). */
function fakePage(flagAt: number | null) {
  return {
    setViewport: vi.fn(async () => {}),
    goto: vi.fn(async () => null),
    waitForFunction: vi.fn((_expr: string, { timeout }: { timeout: number }) => new Promise((resolve, reject) => {
      if (flagAt !== null && flagAt <= timeout) setTimeout(() => resolve(true), flagAt);
      else setTimeout(() => reject(new Error('Waiting failed: timeout exceeded')), timeout);
    })),
    waitForNetworkIdle: vi.fn(({ idleTime }: { idleTime: number }) => new Promise((resolve) => setTimeout(resolve, idleTime))),
    // declaresReadyFlag(): the page uses the flag iff it ever sets it; fonts.ready: anything.
    evaluate: vi.fn(async () => flagAt !== null),
    screenshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

const env = {
  BROWSER: {},
  SHAREOUT_BASE_URL: 'https://shareout.test',
  DB: {
    prepare: () => ({ bind: () => ({ first: async () => ({ slug: 'demo', workspace_id: null }), run: async () => ({}) }) }),
  },
  ARTIFACTS: { put: vi.fn(async () => {}) },
} as unknown as Env;

async function thumbnailMs(flagAt: number | null): Promise<number> {
  const page = fakePage(flagAt);
  vi.mocked(puppeteer.launch).mockResolvedValue({ newPage: async () => page, close: async () => {} } as never);
  const start = Date.now();
  const done = generateArtifactThumbnail(env, 'art_ready').then((ok) => ({ ok, at: Date.now() }));
  await vi.runAllTimersAsync();
  const { ok, at } = await done;
  expect(ok).toBe(true);
  return at - start;
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('capture wait: ready flag raced against network idle', () => {
  it('a thumbnail of a page without the ready flag finishes ≥ 8 s sooner than waiting out the flag', async () => {
    const elapsed = await thumbnailMs(null);
    const before = THUMB_TIMEOUT_MS + IDLE_MS + THUMB_SETTLE_MS + CARD_PAUSE_MS; // flag timeout, then idle, then settle
    expect(elapsed).toBe(IDLE_MS + THUMB_SETTLE_MS + CARD_PAUSE_MS);
    expect(before - elapsed).toBeGreaterThanOrEqual(8000);
  });

  it('a page that takes part in the protocol is still captured only after it is ready', async () => {
    const elapsed = await thumbnailMs(5000);
    expect(elapsed).toBe(5000 + IDLE_MS + THUMB_SETTLE_MS + CARD_PAUSE_MS);
  });

  it('report captures (requireReadyFlag) still wait out the flag on a page that never declares it', async () => {
    const start = Date.now();
    const done = waitForArtifactReady(fakePage(null) as never, { idleTimeout: THUMB_TIMEOUT_MS, settleMs: THUMB_SETTLE_MS, requireReadyFlag: true })
      .then(() => Date.now());
    await vi.runAllTimersAsync();
    expect((await done) - start).toBe(THUMB_TIMEOUT_MS + IDLE_MS + THUMB_SETTLE_MS);
  });
});
