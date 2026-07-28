/**
 * Index router test suite: scheduled cron.
 * Registered from `index.test.ts` so Vitest hoists `vi.mock` in the entry file.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HandlerMocks } from '../handlers';
import worker from '../../../../src/index';
import {
  APEX,
  SUB,
  authed,
  createEnv,
  fetchPath,
  handlerTag,
  githubState,
  sheetsState,
} from '../fixtures';

export function registerScheduledCronTests(handlers: HandlerMocks): void {
describe('index router — scheduled cron', () => {
  it('delegates scheduled events via waitUntil', async () => {
    const env = createEnv();
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const scheduledTime = Date.parse('2026-05-30T01:00:00Z');
    await worker.scheduled({ scheduledTime } as ScheduledEvent, env, ctx);
    expect(ctx.waitUntil).toHaveBeenCalled();
    expect(handlers.handleScheduledEvent).toHaveBeenCalledWith(env, scheduledTime);
  });
});
}
