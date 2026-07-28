// Pins that a successful publish fires auto-summary generation via ctx.waitUntil
// (never on the request's critical path) — the actual summarization logic is
// covered in auto-summary.test.ts, this only pins the post-publish wiring.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import type { Env } from '../../../src/types';

const generateArtifactSummary = vi.fn(async () => {});
vi.mock('../../../src/publish/auto-summary', () => ({
  generateArtifactSummary: (...a: unknown[]) => generateArtifactSummary(...a),
}));
vi.mock('../../../src/search/semantic', () => ({ indexArtifactVector: async () => {} }));
vi.mock('../../../src/email/gateway', () => ({ dispatchLifecycleEmail: async () => {} }));
vi.mock('../../../src/scheduling/events', () => ({ emitJobEvent: async () => {} }));
vi.mock('../../../src/assets/usage', () => ({ scanFileUsage: async () => {} }));
vi.mock('../../../src/knowledge', () => ({ isKnowledgeEnabled: async () => false, enqueueIngest: async () => {} }));
vi.mock('../../../src/tests/block-gate', () => ({
  shouldBlockPublish: async () => false, stageCandidate: async () => {}, runBlockGate: async () => {},
}));
vi.mock('../../../src/publish/monitor-tests', () => ({ maybeRunMonitorTests: async () => {} }));

const { schedulePostPublishTasks } = await import('../../../src/publish/deployment');

function fakeCtx() {
  const tasks: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => { tasks.push(p); },
    tasks,
  } as unknown as ExecutionContext & { tasks: Promise<unknown>[] };
}

const baseOpts = {
  versionId: 'v1', workspaceId: null, routingSlug: 's', blocking: false,
  firstPublish: false, name: 'N', publicUrl: 'http://x',
};

beforeEach(() => generateArtifactSummary.mockClear());

describe('schedulePostPublishTasks — auto-summary wiring', () => {
  it('fires generateArtifactSummary(env, artifactId) for html artifacts, off the response path', async () => {
    const ctx = fakeCtx();
    schedulePostPublishTasks({} as Env, { id: 'u1' } as AuthUser, ctx, {
      ...baseOpts, artifactId: 'art1', artifactType: 'html',
    });
    // Registered via ctx.waitUntil rather than awaited inline on the response path.
    expect(ctx.tasks.length).toBeGreaterThan(0);
    await Promise.all(ctx.tasks);
    expect(generateArtifactSummary).toHaveBeenCalledWith(expect.anything(), 'art1');
  });

  it('skips non-html artifact types', async () => {
    const ctx = fakeCtx();
    schedulePostPublishTasks({} as Env, { id: 'u1' } as AuthUser, ctx, {
      ...baseOpts, artifactId: 'art2', artifactType: 'csv',
    });
    await Promise.all(ctx.tasks);
    expect(generateArtifactSummary).not.toHaveBeenCalled();
  });

  it('is a no-op without an executionCtx (never blocks or throws)', () => {
    expect(() =>
      schedulePostPublishTasks({} as Env, { id: 'u1' } as AuthUser, undefined, {
        ...baseOpts, artifactId: 'art3', artifactType: 'html',
      }),
    ).not.toThrow();
    expect(generateArtifactSummary).not.toHaveBeenCalled();
  });
});
