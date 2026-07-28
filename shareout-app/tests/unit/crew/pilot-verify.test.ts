import { describe, it, expect } from 'vitest';
import { pilotVerifyTool, _internal } from '../../../src/crew/tools/pilot-verify';
import { CREW_TOOLS } from '../../../src/crew/tool-registry';

// D1 stub that answers the single production-deployment lookup resolveOwnedArtifact
// makes. `row` is what the JOIN returns for the requested artifact (null = no deploy).
function fakeEnv(row: Record<string, unknown> | null, extras: Record<string, unknown> = {}) {
  return {
    SHAREOUT_BASE_URL: 'https://shareout.example.com',
    SESSION_SECRET: 'test-secret',
    DB: {
      prepare: () => ({
        bind: () => ({ async first() { return row; } }),
      }),
    },
    ...extras,
  } as never;
}

function ctx(env: unknown, principal: Partial<{ ownerId: string; workspaceId: string }> = {}) {
  return {
    data: { env, artifactId: 'art_crew' },
    principal: {
      ownerId: 'usr_owner', crewId: 'crew_1', runId: 'run_1', artifactId: 'art_crew',
      workspaceId: 'wsp_1', ...principal,
    },
    limits: {},
  } as never;
}

describe('pilot_verify registration', () => {
  it('is registered in CREW_TOOLS as a write tool', () => {
    expect(CREW_TOOLS['pilot_verify']).toBe(pilotVerifyTool);
    expect(pilotVerifyTool.name).toBe('pilot_verify');
    expect(pilotVerifyTool.mode).toBe('write');
  });

  it('declares the expected input schema', () => {
    const schema = pilotVerifyTool.input_schema as {
      properties: Record<string, unknown>; required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['artifactId', 'task', 'maxSteps'])
    );
    expect(schema.required).toEqual(expect.arrayContaining(['artifactId', 'task']));
  });
});

describe('pilot_verify maxSteps clamp', () => {
  it('defaults to 6 when absent or non-numeric', () => {
    expect(_internal.clampSteps(undefined)).toBe(6);
    expect(_internal.clampSteps('x')).toBe(6);
    expect(_internal.clampSteps(NaN)).toBe(6);
  });
  it('clamps below 1 up to 1 and above 8 down to 8', () => {
    expect(_internal.clampSteps(0)).toBe(1);
    expect(_internal.clampSteps(-5)).toBe(1);
    expect(_internal.clampSteps(50)).toBe(8);
    expect(_internal.clampSteps(8)).toBe(8);
  });
  it('floors fractional step counts', () => {
    expect(_internal.clampSteps(3.9)).toBe(3);
  });
});

describe('pilot_verify input validation', () => {
  it('rejects a missing artifactId without launching a browser', async () => {
    const res = await pilotVerifyTool.execute(
      ctx(fakeEnv(null, { BROWSER: {} })),
      { task: 'do a thing' },
    ) as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/artifactId/);
  });

  it('rejects a missing task', async () => {
    const res = await pilotVerifyTool.execute(
      ctx(fakeEnv(null, { BROWSER: {} })),
      { artifactId: 'art_x' },
    ) as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/task/);
  });
});

describe('pilot_verify graceful degradation', () => {
  it('returns success:false when Browser Rendering is unbound (no throw)', async () => {
    const res = await pilotVerifyTool.execute(
      ctx(fakeEnv({ slug: 's', owner_id: 'usr_owner', workspace_id: 'wsp_1' })), // no BROWSER
      { artifactId: 'art_x', task: 'verify the form' },
    ) as { success: boolean; error: string; data: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Browser Rendering not available/);
    expect(res.data).toBe('');
  });
});

describe('pilot_verify ownership scope', () => {
  it('refuses an artifact the crew owner cannot access', async () => {
    // BROWSER present so we get past the graceful gate and reach the ownership check.
    const env = fakeEnv(
      { slug: 's', owner_id: 'someone_else', workspace_id: 'wsp_other' },
      { BROWSER: {} },
    );
    const res = await pilotVerifyTool.execute(
      ctx(env),
      { artifactId: 'art_foreign', task: 'verify' },
    ) as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/cannot access/);
  });

  it('refuses an artifact with no production deployment', async () => {
    const res = await pilotVerifyTool.execute(
      ctx(fakeEnv(null, { BROWSER: {} })),
      { artifactId: 'art_undeployed', task: 'verify' },
    ) as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no production deployment/);
  });

  it('accepts an artifact owned by the crew owner', async () => {
    const r = await _internal.resolveOwnedArtifact(
      fakeEnv({ slug: 'my-slug', owner_id: 'usr_owner', workspace_id: 'wsp_1' }),
      'art_x', 'usr_owner', 'wsp_1',
    );
    expect(r).toEqual({ slug: 'my-slug' });
  });

  it('accepts an artifact in the crew workspace even if a different owner', async () => {
    const r = await _internal.resolveOwnedArtifact(
      fakeEnv({ slug: 'ws-slug', owner_id: 'other', workspace_id: 'wsp_1' }),
      'art_x', 'usr_owner', 'wsp_1',
    );
    expect(r).toEqual({ slug: 'ws-slug' });
  });
});
