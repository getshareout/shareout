import { describe, it, expect } from 'vitest';
import { selectTools, defaultCapabilities, ACCOUNT_TOOLS, CONNECTOR_TOOLS, SCHEDULE_TOOLS, BUILD_TOOLS } from '../../../src/chat-agent/tools/index';
import { createArtifactTool } from '../../../src/chat-agent/tools/build';

const names = (ts: { name: string }[]) => ts.map((t) => t.name);

describe('capabilities → tool selection', () => {
  it('all account surfaces are fully powered by default', () => {
    for (const platform of ['web', 'telegram', 'slack'] as const) {
      const caps = defaultCapabilities(platform);
      expect(caps).toEqual({ canQueryConnections: true, canSchedule: true, canBuild: true });
    }
  });

  it('selectTools gates each group on its flag', () => {
    const base = names(selectTools({ canQueryConnections: false, canSchedule: false, canBuild: false }));
    expect(base).toEqual(names(ACCOUNT_TOOLS));
    expect(base).not.toContain('query_connection');
    expect(base).not.toContain('create_schedule');
    expect(base).not.toContain('create_artifact');

    const full = names(selectTools({ canQueryConnections: true, canSchedule: true, canBuild: true }));
    for (const t of [...CONNECTOR_TOOLS, ...SCHEDULE_TOOLS, ...BUILD_TOOLS]) expect(full).toContain(t.name);
  });

  it('build group is exactly create_artifact', () => {
    expect(names(BUILD_TOOLS)).toEqual(['create_artifact']);
  });
});

describe('create_artifact tool', () => {
  it('proposes a build_artifact action (no work until confirmed)', async () => {
    const out = await createArtifactTool.execute({ env: {} as never, userId: 'u1' }, { prompt: 'a pricing page for my SaaS' });
    expect(out).toEqual({ __propose: { kind: 'build_artifact', name: 'a pricing page for my SaaS', prompt: 'a pricing page for my SaaS' } });
  });

  it('honors an explicit name', async () => {
    const out = await createArtifactTool.execute({ env: {} as never, userId: 'u1' }, { prompt: 'build x', name: 'My Page' }) as { __propose: { name: string } };
    expect(out.__propose.name).toBe('My Page');
  });
});
