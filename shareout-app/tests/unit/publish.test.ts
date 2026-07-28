import { afterEach, describe, expect, it, vi } from 'vitest';
import { handlePublish } from '../../src/publish';
import { OPEN_VISIBILITY_PAYWALL_MESSAGE } from '../../src/access/allow-open';
import { shortHash } from '../../src/validation';
import type { Env, PublishRequest } from '../../src/types';

const API_TOKEN = 'so_validtoken';
const USER_ID = 'usr_1';
const WORKSPACE_ID = 'wsp_default';
const BASE_URL = 'https://shareout.example.com';

const baseEnv = {
  SHAREOUT_BASE_URL: BASE_URL,
} as Env;

async function tokenHash(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeR2Mock(putImpl?: (...args: unknown[]) => Promise<void>): Env['ARTIFACTS'] {
  return {
    put: vi.fn(putImpl ?? (async () => undefined)),
    get: vi.fn(),
    delete: vi.fn(),
  } as unknown as Env['ARTIFACTS'];
}

function makeSlugsKvMock(): Env['SLUGS'] {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(async () => undefined),
  } as unknown as Env['SLUGS'];
}

function validBody(overrides: Partial<PublishRequest> = {}): PublishRequest {
  return {
    name: 'Demo Artifact',
    files: [
      { path: 'index.html', content: '<h1>Hello</h1>', mime: 'text/html' },
      { path: 'styles.css', content: 'body{}', mime: 'text/css' },
    ],
    ...overrides,
  };
}

function publishRequest(body: unknown, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${API_TOKEN}`);
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Request('https://shareout.example.com/v1/publish', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...init,
  });
}

type DbScenario = {
  rateLimitCount?: number | null;
  workspaceId?: string | null;
  workspaceRole?: string | null;
  /** `undefined` = default exists; `null` = folder missing */
  folderRow?: { id: string } | null | undefined;
  /** Existing artifact matched by display_slug; `slug` is its routing slug (reused on re-publish). */
  workspaceArtifact?: { id: string; owner_id: string | null; slug?: string } | null;
  globalArtifact?: { id: string; owner_id: string | null; slug?: string } | null;
  collaboratorRole?: string | null;
  userEmail?: string | null;
  maxVersion?: number;
  workspaceSlug?: string | null;
  /** Publisher's denormalized account tier (users.tier); undefined → free. */
  userTier?: string | null;
  foldersById?: Record<string, { slug: string; parent_id: string | null }>;
  /** Routing slugs already claimed globally by *other* artifacts (artifacts.slug). */
  takenRoutingSlugs?: string[];
  /** External-sharing Phase 2: workspace that owns the target folder (canAccess seed). */
  folderWorkspaceId?: string | null;
  /** External-sharing Phase 2: grant rows returned by canAccess's grants query. */
  grants?: Array<{ resource_type: string; resource_id: string; capability: string }>;
  /** External-sharing Phase 2: folder ancestor chain returned by the recursive CTE. */
  folderChain?: string[];
};

async function makePublishEnv(
  scenario: DbScenario = {},
  options: {
    r2Put?: (...args: unknown[]) => Promise<void>;
    withSlugsKv?: boolean;
    bindCaptures?: Array<{ sql: string; args: unknown[] }>;
  } = {},
): Promise<Env> {
  const hash = await tokenHash(API_TOKEN);
  const workspaceId = scenario.workspaceId === undefined ? WORKSPACE_ID : scenario.workspaceId;
  const workspaceSlug = scenario.workspaceSlug ?? 'my-workspace';

  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => {
        options.bindCaptures?.push({ sql, args: bindArgs });
        return {
          first: vi.fn(async () => {
            const handlers = scenario as DbScenario;
            return dbFirst(sql, bindArgs, hash, workspaceId, workspaceSlug, handlers);
          }),
          all: vi.fn(async () => {
            const s = scenario as DbScenario;
            if (sql.includes('FROM grants')) return { results: s.grants ?? [] };
            if (sql.includes('WITH RECURSIVE chain')) return { results: (s.folderChain ?? []).map(id => ({ id })) };
            return { results: [] };
          }),
          run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
        };
      }),
    })),
  } as unknown as Env['DB'];

  function dbFirst(
    sql: string,
    args: unknown[],
    tokenHash: string,
    wsId: string | null,
    wsSlug: string | null,
    scenario: DbScenario,
  ): unknown {
    if (sql.includes('tokens t') && args[0] === tokenHash) {
      return { user_id: USER_ID, email: 'owner@example.com', username: 'owner' };
    }
    if (sql.includes('rate_limits') && sql.includes('count')) {
      if (scenario.rateLimitCount === undefined) return null;
      return scenario.rateLimitCount === null ? null : { count: scenario.rateLimitCount };
    }
    if (sql.includes('workspaces WHERE owner_id')) {
      return wsId ? { id: wsId } : null;
    }
    if (sql.includes('workspace_members') && sql.includes('role')) {
      return scenario.workspaceRole ? { role: scenario.workspaceRole } : null;
    }
    // External-sharing Phase 2: folder-workspace lookup (fence + canAccess seed).
    if (sql.includes('SELECT workspace_id FROM folders WHERE id = ?')) {
      return scenario.folderWorkspaceId ? { workspace_id: scenario.folderWorkspaceId } : null;
    }
    if (sql.includes('FROM folders WHERE id = ?') && sql.includes('workspace_id')) {
      if (scenario.folderRow === null) return null;
      if (scenario.folderRow) return scenario.folderRow;
      return args[1] === WORKSPACE_ID ? { id: args[0] } : null;
    }
    if (sql.includes('artifacts WHERE display_slug = ? AND workspace_id = ?')) {
      if (!scenario.workspaceArtifact) return null;
      return { ...scenario.workspaceArtifact, slug: scenario.workspaceArtifact.slug ?? (args[0] as string) };
    }
    if (sql.includes('artifacts WHERE display_slug = ? AND workspace_id IS NULL')) {
      if (!scenario.globalArtifact) return null;
      return { ...scenario.globalArtifact, slug: scenario.globalArtifact.slug ?? (args[0] as string) };
    }
    if (sql.includes('SELECT owner_id FROM artifacts WHERE id = ?')) {
      const artifact = scenario.workspaceArtifact ?? scenario.globalArtifact;
      return artifact ? { owner_id: artifact.owner_id } : null;
    }
    if (sql.includes('SELECT email FROM users WHERE id = ?')) {
      return { email: scenario.userEmail ?? 'owner@example.com' };
    }
    if (sql.includes('SELECT tier FROM users WHERE id = ?')) {
      return { tier: scenario.userTier ?? 'free' };
    }
    if (sql.includes('SELECT role FROM collaborators')) {
      return scenario.collaboratorRole ? { role: scenario.collaboratorRole } : null;
    }
    if (sql.includes('MAX(version_no)')) {
      return { max_v: scenario.maxVersion ?? 0 };
    }
    if (sql.includes('SELECT 1 FROM artifacts WHERE slug = ?')) {
      return scenario.takenRoutingSlugs?.includes(args[0] as string) ? { 1: 1 } : null;
    }
    if (sql.includes('SELECT slug FROM workspaces WHERE id = ?')) {
      return args[0] && wsSlug ? { slug: wsSlug } : null;
    }
    if (sql.includes('SELECT slug, parent_id FROM folders WHERE id = ?')) {
      return scenario.foldersById?.[args[0] as string] ?? null;
    }
    return null;
  }

  const env: Env = {
    ...baseEnv,
    DB,
    ARTIFACTS: makeR2Mock(options.r2Put),
  };
  if (options.withSlugsKv) {
    env.SLUGS = makeSlugsKvMock();
  }
  return env;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('handlePublish auth and validation', () => {
  it('returns 401 when token is missing or invalid', async () => {
    const env = await makePublishEnv();

    const noAuth = await handlePublish(
      new Request('https://shareout.example.com/v1/publish', { method: 'POST' }),
      env,
    );
    expect(noAuth.status).toBe(401);
    await expect(noAuth.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });

    const badToken = await handlePublish(
      publishRequest(validBody(), { headers: { Authorization: 'Bearer not_so_token' } }),
      env,
    );
    expect(badToken.status).toBe(401);
  });

  it('returns 429 when publish rate limit is exceeded', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:30:00Z'));

    const env = await makePublishEnv({ rateLimitCount: 100 });
    const response = await handlePublish(publishRequest(validBody()), env);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      remaining: 0,
    });
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('returns 400 for invalid JSON and validation errors', async () => {
    const env = await makePublishEnv();

    const badJson = await handlePublish(
      new Request('https://shareout.example.com/v1/publish', {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      env,
    );
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });

    const validation = await handlePublish(
      publishRequest({ name: '', files: [] }),
      env,
    );
    expect(validation.status).toBe(400);
    await expect(validation.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('handlePublish workspace and folder gates', () => {
  it('returns 403 when workspace_id is provided but user has no role', async () => {
    const env = await makePublishEnv({ workspaceRole: null });
    const response = await handlePublish(
      publishRequest(validBody({ workspace_id: 'wsp_other' })),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'FORBIDDEN',
      error: 'Workspace not found or access denied',
    });
  });

  it('returns 404 when folder_id is not in the workspace', async () => {
    const env = await makePublishEnv({
      workspaceRole: 'owner',
      folderRow: null,
    });
    const response = await handlePublish(
      publishRequest(validBody({ workspace_id: WORKSPACE_ID, folder_id: 'fld_missing' })),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'FOLDER_NOT_FOUND' });
  });

  // External-sharing spine (work/030) Phase 2: create-in-sandbox fence.
  it('returns 403 for an external (no role) targeting a folder WITHOUT a create grant', async () => {
    const env = await makePublishEnv({
      workspaceRole: null,
      folderWorkspaceId: WORKSPACE_ID,
      grants: [], // no create grant
    });
    const response = await handlePublish(
      publishRequest(validBody({ workspace_id: WORKSPACE_ID, folder_id: 'fld_ext' })),
      env,
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets an external author create FENCED (private, pinned to folder) with a create grant', async () => {
    const captures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv({
      workspaceRole: null,
      folderWorkspaceId: WORKSPACE_ID,
      grants: [{ resource_type: 'folder', resource_id: 'fld_ext', capability: 'create' }],
      folderChain: ['fld_ext'],
    }, { bindCaptures: captures });
    const response = await handlePublish(
      publishRequest(validBody({ workspace_id: WORKSPACE_ID, folder_id: 'fld_ext', visibility: 'workspace' })),
      env,
    );
    expect(response.status).toBe(201);
    // Fence: the INSERT must record visibility 'private' and folder_id 'fld_ext',
    // never the requested 'workspace'.
    const insert = captures.find(c => c.sql.includes('INSERT INTO artifacts'));
    expect(insert).toBeTruthy();
    expect(insert!.args).toContain('private');
    expect(insert!.args).toContain('fld_ext');
    expect(insert!.args).not.toContain('workspace');
  });
});

describe('handlePublish success paths', () => {
  it('creates a new artifact and returns 201 with deployment URLs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:30:00Z'));

    const env = await makePublishEnv({ rateLimitCount: 5 }, { withSlugsKv: true });
    const response = await handlePublish(
      publishRequest(validBody({ slug: 'my-demo' })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as {
      artifact: { id: string };
      version: { id: string; version_no: number };
      deployment: { slug: string; url: string; namespaced_url: string; embed_url: string };
    };

    expect(body.artifact.id).toMatch(/^art_/);
    expect(body.version.version_no).toBe(1);
    expect(body.deployment).toMatchObject({
      slug: 'my-demo',
      url: `${BASE_URL}/a/my-demo/`,
      embed_url: `${BASE_URL}/embed/my-demo/`,
    });
    // No workspace_id → Personal publish, so no workspace-namespaced URL.
    expect(body.deployment.namespaced_url).toBeUndefined();
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('94');
    expect(env.ARTIFACTS.put).toHaveBeenCalledTimes(2);
    expect(env.SLUGS?.delete).toHaveBeenCalledWith('deploy:my-demo');
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO artifacts'));
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO versions'));
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO deployments'));
  });

  it('self-host (BILLING_MODE=none) publishes hello HTML without AI/Browser/Email', async () => {
    const env = await makePublishEnv({ rateLimitCount: 0 }, { withSlugsKv: true });
    env.BILLING_MODE = 'none';
    // ponytail: prove publish works when optional paid bindings are absent
    delete (env as { AI?: unknown }).AI;
    delete (env as { BROWSER?: unknown }).BROWSER;
    delete (env as { VECTORIZE?: unknown }).VECTORIZE;
    delete (env as { EMAIL?: unknown }).EMAIL;

    const response = await handlePublish(
      publishRequest({
        name: 'Hello ShareOut',
        slug: 'hello-shareout',
        files: [
          {
            path: 'index.html',
            content: '<!doctype html><html><body><h1>Hello ShareOut</h1></body></html>',
            mime: 'text/html',
          },
        ],
      }),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { deployment: { slug: string; url: string } };
    expect(body.deployment.slug).toBe('hello-shareout');
    expect(body.deployment.url).toBe(`${BASE_URL}/a/hello-shareout/`);
    expect(env.ARTIFACTS.put).toHaveBeenCalled();
  });

  it('keeps the bare routing slug when it is free globally even if a different slug is taken', async () => {
    const env = await makePublishEnv(
      { rateLimitCount: 5, takenRoutingSlugs: ['some-other-slug'] },
      { withSlugsKv: true },
    );
    const response = await handlePublish(publishRequest(validBody({ slug: 'my-demo' })), env);

    expect(response.status).toBe(201);
    const body = await response.json() as { deployment: { slug: string; url: string; subdomain_url?: string } };
    expect(body.deployment.slug).toBe('my-demo');
    expect(body.deployment.url).toBe(`${BASE_URL}/a/my-demo/`);
    // Personal (non-workspace) artifacts have no subdomain URL — the apex /a/ URL is the share URL.
    expect(body.deployment.subdomain_url).toBeUndefined();
  });

  it('suffixes the routing slug with the workspace hash when the bare slug is taken by another artifact', async () => {
    const captures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv(
      { rateLimitCount: 5, workspaceId: WORKSPACE_ID, workspaceRole: 'owner', takenRoutingSlugs: ['my-demo'] },
      { withSlugsKv: true, bindCaptures: captures },
    );
    const response = await handlePublish(
      publishRequest(validBody({ slug: 'my-demo', workspace_id: WORKSPACE_ID })),
      env,
    );

    expect(response.status).toBe(201);
    const expected = `my-demo-${shortHash(WORKSPACE_ID)}`;
    const body = await response.json() as { deployment: { slug: string; url: string; namespaced_url: string; subdomain_url: string } };
    // Canonical URL gets the suffix; the namespaced + subdomain URLs keep the clean human slug.
    expect(body.deployment.slug).toBe(expected);
    expect(body.deployment.url).toBe(`${BASE_URL}/a/${expected}/`);
    expect(body.deployment.namespaced_url).toBe(`${BASE_URL}/@my-workspace/my-demo/`);
    // Workspace artifacts advertise the clean subdomain URL, not the suffixed apex routing key.
    expect(body.deployment.subdomain_url).toBe('https://my-workspace.shareout.example.com/my-demo/');

    const depInsert = captures.find(c => c.sql.includes('INSERT INTO deployments'));
    expect(depInsert?.args[3]).toBe(expected);
    expect(env.SLUGS?.delete).toHaveBeenCalledWith(`deploy:${expected}`);
  });

  it('suffixes a personal collision with the owner hash', async () => {
    const env = await makePublishEnv(
      { rateLimitCount: 5, workspaceId: null, takenRoutingSlugs: ['my-demo'] },
      { withSlugsKv: true },
    );
    const response = await handlePublish(publishRequest(validBody({ slug: 'my-demo' })), env);

    expect(response.status).toBe(201);
    const body = await response.json() as { deployment: { slug: string } };
    expect(body.deployment.slug).toBe(`my-demo-${shortHash(USER_ID)}`);
  });

  it('reuses the existing routing slug on re-publish (idempotent canonical URL)', async () => {
    const env = await makePublishEnv(
      {
        rateLimitCount: 5,
        workspaceId: WORKSPACE_ID,
        workspaceRole: 'owner',
        // Existing artifact matched by display_slug; its routing slug is reused.
        workspaceArtifact: { id: 'art_existing', owner_id: USER_ID, slug: 'my-demo-stable' },
        takenRoutingSlugs: ['my-demo'],
      },
      { withSlugsKv: true },
    );
    const response = await handlePublish(
      publishRequest(validBody({ slug: 'my-demo', workspace_id: WORKSPACE_ID })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { deployment: { slug: string; url: string } };
    expect(body.deployment.slug).toBe('my-demo-stable');
    expect(body.deployment.url).toBe(`${BASE_URL}/a/my-demo-stable/`);
  });

  it('enables the agent when an agent block is in the publish payload', async () => {
    const env = await makePublishEnv();
    const response = await handlePublish(
      publishRequest(validBody({ slug: 'with-agent', agent: { enabled: true, systemPrompt: 'You are helpful.' } })),
      env,
    );
    expect(response.status).toBe(201);
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('artifact_agent_config'));
  });

  it('does not touch agent config when no agent block is provided', async () => {
    const env = await makePublishEnv();
    await handlePublish(publishRequest(validBody({ slug: 'no-agent' })), env);
    expect(env.DB.prepare).not.toHaveBeenCalledWith(expect.stringContaining('artifact_agent_config'));
  });

  it('generates slug from name when slug is omitted', async () => {
    const env = await makePublishEnv();
    const response = await handlePublish(
      publishRequest(validBody({ name: 'My Cool Page!' })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { deployment: { slug: string } };
    expect(body.deployment.slug).toBe('my-cool-page');
  });

  it('increments version when updating an existing workspace artifact', async () => {
    const env = await makePublishEnv({
      workspaceArtifact: { id: 'art_existing', owner_id: USER_ID },
      maxVersion: 2,
    });

    const response = await handlePublish(
      publishRequest(validBody({ slug: 'existing-slug' })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { artifact: { id: string }; version: { version_no: number } };
    expect(body.artifact.id).toBe('art_existing');
    expect(body.version.version_no).toBe(3);
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE artifacts SET'));
    expect(env.DB.prepare).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO artifacts'));
  });

  // Regression: an artifact moved into a folder must still be matched on
  // re-publish. The dedup used to be scoped by folder_id, so re-publishing
  // without the matching folder_id fell through to INSERT and collided on the
  // globally-unique slug (500). See publish.ts existing-artifact lookup.
  it('re-publishes an artifact moved into a folder without colliding on slug', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv(
      { workspaceArtifact: { id: 'art_moved', owner_id: USER_ID }, workspaceRole: 'owner', maxVersion: 8 },
      { bindCaptures },
    );

    // Re-publish with the same slug but NO folder_id (the artifact has since
    // been organized into a folder in the UI).
    const response = await handlePublish(
      publishRequest(validBody({ slug: 'customer-scorecard', workspace_id: WORKSPACE_ID })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { artifact: { id: string }; version: { version_no: number } };
    expect(body.artifact.id).toBe('art_moved');
    expect(body.version.version_no).toBe(9);
    expect(env.DB.prepare).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO artifacts'));

    // The existing-artifact lookup must NOT be scoped by folder_id.
    const dedup = bindCaptures.find(c => c.sql.includes('FROM artifacts WHERE display_slug = ? AND workspace_id = ?'));
    expect(dedup).toBeTruthy();
    expect(dedup!.sql).not.toContain('folder_id');

    // The UPDATE preserves the artifact's folder when none is supplied.
    const update = bindCaptures.find(c => c.sql.includes('UPDATE artifacts SET'));
    expect(update).toBeTruthy();
    expect(update!.sql).toContain('folder_id = COALESCE(?, folder_id)');
    // folder_id bind (index 5) is null → COALESCE keeps the current folder.
    expect(update!.args[5]).toBeNull();
  });

  it('honors an explicit folder_id when moving an artifact on re-publish', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv(
      { workspaceArtifact: { id: 'art_moved', owner_id: USER_ID }, workspaceRole: 'owner', maxVersion: 1 },
      { bindCaptures },
    );

    const response = await handlePublish(
      publishRequest(validBody({ slug: 'customer-scorecard', workspace_id: WORKSPACE_ID, folder_id: 'fld_target' })),
      env,
    );

    expect(response.status).toBe(201);
    const update = bindCaptures.find(c => c.sql.includes('UPDATE artifacts SET'));
    expect(update!.args[5]).toBe('fld_target');
  });

  it('includes mobile_url and PWA URLs when mobile and PWA are enabled', async () => {
    const iconHeader = 'iVBORw0KGgo';
    const icon = iconHeader + 'A'.repeat(Math.max(0, Math.ceil((2048 * 4) / 3) - iconHeader.length));

    const env = await makePublishEnv();
    const response = await handlePublish(
      publishRequest(validBody({
        slug: 'pwa-app',
        mobile_html: '<html>mobile</html>',
        pwa: {
          enabled: true,
          name: 'PWA App',
          short_name: 'PWA',
          icon,
        },
      })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as {
      deployment: { mobile_url: string };
      pwa: { manifest_url: string; service_worker_url: string; installable: boolean };
    };
    expect(body.deployment.mobile_url).toBe(`${BASE_URL}/a/pwa-app/?v=mobile`);
    expect(body.pwa).toMatchObject({
      manifest_url: `${BASE_URL}/a/pwa-app/manifest.json`,
      service_worker_url: `${BASE_URL}/a/pwa-app/sw.js`,
      installable: true,
    });
    expect(env.ARTIFACTS.put).toHaveBeenCalledWith(
      expect.stringMatching(/\/v\d+\/mobile\.html$/),
      expect.any(Uint8Array),
      expect.any(Object),
    );
  });

  it('builds namespaced_url with nested folder path', async () => {
    const env = await makePublishEnv({
      workspaceRole: 'owner',
      foldersById: {
        fld_child: { slug: 'child', parent_id: 'fld_parent' },
        fld_parent: { slug: 'docs', parent_id: null },
      },
    });

    const response = await handlePublish(
      publishRequest(validBody({
        slug: 'nested',
        workspace_id: WORKSPACE_ID,
        folder_id: 'fld_child',
      })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { deployment: { namespaced_url: string } };
    expect(body.deployment.namespaced_url).toBe(`${BASE_URL}/@my-workspace/docs/child/nested/`);
  });

  it('classifies critical CSS, JS, and font assets in the manifest', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv({}, { bindCaptures });

    const response = await handlePublish(
      publishRequest(validBody({
        slug: 'critical-assets',
        files: [
          { path: 'index.html', content: '<h1></h1>', mime: 'text/html' },
          { path: 'theme.css', content: 'body{}', mime: 'text/css' },
          { path: 'app.bundle.js', content: 'console.log(1)', mime: 'application/javascript' },
          { path: 'fonts/inter.woff2', content: 'font-data', mime: 'font/woff2' },
        ],
      })),
      env,
    );

    expect(response.status).toBe(201);
    const manifestBind = bindCaptures.find(c => c.sql.includes('UPDATE versions SET manifest_json'));
    expect(manifestBind).toBeTruthy();
    const manifest = JSON.parse(manifestBind!.args[0] as string) as {
      critical: { css: string[]; js: string[]; fonts: string[] };
    };
    expect(manifest.critical).toMatchObject({
      css: ['theme.css'],
      js: ['app.bundle.js'],
      fonts: ['fonts/inter.woff2'],
    });
  });

  it('stores base64-encoded assets in R2', async () => {
    const env = await makePublishEnv();
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const b64 = btoa(String.fromCharCode(...pngBytes));

    const response = await handlePublish(
      publishRequest(validBody({
        files: [
          { path: 'index.html', content: '<h1></h1>', mime: 'text/html' },
          { path: 'pixel.png', content: b64, encoding: 'base64', mime: 'image/png' },
        ],
      })),
      env,
    );

    expect(response.status).toBe(201);
    expect(env.ARTIFACTS.put).toHaveBeenCalledWith(
      expect.stringMatching(/pixel\.png$/),
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({ contentType: 'image/png' }),
      }),
    );
  });
});

describe('handlePublish auth visibility and collaborators', () => {
  it('returns 403 when updating another users artifact without editor access', async () => {
    const env = await makePublishEnv({
      workspaceArtifact: { id: 'art_other', owner_id: 'usr_other' },
      collaboratorRole: null,
    });

    const response = await handlePublish(
      publishRequest(validBody({ slug: 'taken-slug' })),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'FORBIDDEN',
      error: 'You do not own this artifact',
    });
  });

  it('allows update when collaborator has editor role', async () => {
    const env = await makePublishEnv({
      workspaceArtifact: { id: 'art_shared', owner_id: 'usr_other' },
      collaboratorRole: 'editor',
      maxVersion: 1,
    });

    const response = await handlePublish(
      publishRequest(validBody({ slug: 'shared-slug' })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { artifact: { id: string }; version: { version_no: number } };
    expect(body.artifact.id).toBe('art_shared');
    expect(body.version.version_no).toBe(2);
  });

  it('syncs viewers for google auth with share_with', async () => {
    const env = await makePublishEnv();
    await handlePublish(
      publishRequest(validBody({
        slug: 'shared-viewers',
        share_with: ['Viewer@Example.com', 'viewer@example.com'],
      })),
      env,
    );

    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM collaborators WHERE artifact_id = ? AND role = 'viewer'"),
    );
    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO collaborators'),
    );
  });

  it('syncs credentials when credentials auth is used', async () => {
    const env = await makePublishEnv();
    await handlePublish(
      publishRequest(validBody({
        slug: 'cred-app',
        credentials: [{ user: 'Admin', password: 'secret-pass' }],
      })),
      env,
    );

    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM artifact_passwords WHERE artifact_id = ?'),
    );
    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO artifact_passwords'),
    );
  });

  it('sets private visibility and password auth when password is provided', async () => {
    const env = await makePublishEnv();
    await handlePublish(
      publishRequest(validBody({
        slug: 'private-app',
        password: 'hunter2',
      })),
      env,
    );

    const insertArtifact = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO artifacts'),
    );
    expect(insertArtifact).toBeTruthy();
    const bind = insertArtifact![0];
    expect(typeof bind).toBe('string');
  });

  it('defaults to public visibility when OPEN_VISIBILITY_DISABLED is off', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv({}, { bindCaptures });
    await handlePublish(publishRequest(validBody({ slug: 'open-default' })), env);

    const insert = bindCaptures.find(c => c.sql.includes('INSERT INTO artifacts'));
    expect(insert?.args[4]).toBe('public');
  });

  it('coerces public/unlisted to private when OPEN_VISIBILITY_DISABLED is on', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv({}, { bindCaptures });
    env.OPEN_VISIBILITY_DISABLED = '1';
    await handlePublish(
      publishRequest(validBody({ slug: 'locked', visibility: 'public' })),
      env,
    );

    const insert = bindCaptures.find(c => c.sql.includes('INSERT INTO artifacts'));
    expect(insert?.args[4]).toBe('private');
  });

  it('keeps public visibility in a showcase workspace even when OPEN_VISIBILITY_DISABLED is on', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv({ workspaceRole: 'owner', workspaceSlug: 'showcase' }, { bindCaptures });
    env.OPEN_VISIBILITY_DISABLED = '1';
    env.PUBLIC_SHOWCASE_WORKSPACES = 'showcase';
    await handlePublish(
      publishRequest(validBody({ slug: 'showcase-demo', workspace_id: WORKSPACE_ID, visibility: 'public' })),
      env,
    );

    const insert = bindCaptures.find(c => c.sql.includes('INSERT INTO artifacts'));
    expect(insert?.args[4]).toBe('public');
  });

  it('still coerces to private for a non-showcase workspace when the gate is on', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv({ workspaceRole: 'owner', workspaceSlug: 'team-x' }, { bindCaptures });
    env.OPEN_VISIBILITY_DISABLED = '1';
    env.PUBLIC_SHOWCASE_WORKSPACES = 'showcase';
    await handlePublish(
      publishRequest(validBody({ slug: 'team-demo', workspace_id: WORKSPACE_ID, visibility: 'public' })),
      env,
    );

    const insert = bindCaptures.find(c => c.sql.includes('INSERT INTO artifacts'));
    expect(insert?.args[4]).toBe('private');
  });

  it('keeps public for a user in the rollout even when the gate is on', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv({}, { bindCaptures });
    env.OPEN_VISIBILITY_DISABLED = '1';
    env.PUBLIC_ROLLOUT_PCT = '100';
    await handlePublish(
      publishRequest(validBody({ slug: 'pro-open', visibility: 'public' })),
      env,
    );

    const insert = bindCaptures.find(c => c.sql.includes('INSERT INTO artifacts'));
    expect(insert?.args[4]).toBe('public');
  });

  it('returns a notice when a public artifact is downgraded to private', async () => {
    const env = await makePublishEnv();
    env.OPEN_VISIBILITY_DISABLED = '1';
    const res = await handlePublish(
      publishRequest(validBody({ slug: 'free-blocked', visibility: 'public' })),
      env,
    );
    await expect(res.json()).resolves.toMatchObject({ notice: OPEN_VISIBILITY_PAYWALL_MESSAGE });
  });
});

describe('handlePublish error paths', () => {
  it('returns 500 when R2 storage fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = await makePublishEnv({}, {
      r2Put: async () => {
        throw new Error('R2 unavailable');
      },
    });

    const response = await handlePublish(publishRequest(validBody()), env);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
    expect(body).not.toHaveProperty('details');
    expect(consoleError).toHaveBeenCalled();
  });

  it('returns 403 when updating a global artifact owned by another user', async () => {
    const env = await makePublishEnv({
      workspaceArtifact: null,
      globalArtifact: { id: 'art_global_other', owner_id: 'usr_other' },
      collaboratorRole: null,
    });

    const response = await handlePublish(
      publishRequest(validBody({ slug: 'global-taken' })),
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('updates global legacy artifact when workspace-scoped lookup is empty', async () => {
    const env = await makePublishEnv({
      workspaceArtifact: null,
      globalArtifact: { id: 'art_global', owner_id: USER_ID },
      maxVersion: 4,
    });

    const response = await handlePublish(
      publishRequest(validBody({ slug: 'legacy-global' })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { artifact: { id: string }; version: { version_no: number } };
    expect(body.artifact.id).toBe('art_global');
    expect(body.version.version_no).toBe(5);
  });
});

describe('handlePublish editor-readiness', () => {
  type ReadinessBody = {
    editor_readiness?: {
      manifest: string;
      outline: boolean;
      findings: Array<{ rule: string; level: string; disables?: string }>;
    };
  };

  it('returns a graded readiness profile and stores it for a deficient HTML artifact', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = await makePublishEnv({ rateLimitCount: 5 }, { withSlugsKv: true, bindCaptures });

    const html = '<div data-shareout-page="home"><span data-shareout-binding="json:revenue">0</span></div>';
    const response = await handlePublish(
      publishRequest(validBody({ slug: 'deficient', files: [{ path: 'index.html', content: html, mime: 'text/html' }] })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as ReadinessBody;
    expect(body.editor_readiness?.manifest).toBe('missing');
    expect(body.editor_readiness?.outline).toBe(true);
    expect(body.editor_readiness?.findings).toHaveLength(1);
    expect(body.editor_readiness?.findings[0]).toMatchObject({
      rule: 'binding-undeclared',
      level: 'warning',
    });
    expect(body.editor_readiness?.findings[0].disables).toBeTruthy();

    // Persisted to the artifacts row.
    const stored = bindCaptures.find(c => c.sql.includes('editor_readiness'));
    expect(stored).toBeTruthy();
    // artifact_presentation upsert binds the artifact id first, then the columns.
    expect(String(stored?.args[1])).toContain('binding-undeclared');
  });

  it('returns a clean profile for an editor-ready HTML artifact', async () => {
    const env = await makePublishEnv({ rateLimitCount: 5 }, { withSlugsKv: true });

    const html = [
      '<!doctype html><html><head>',
      '<script type="shareout/manifest">{"version":"2.0","sources":{"json":{"revenue":{"default":{}}}}}</script>',
      '</head><body>',
      '<div data-shareout-page="home"><span data-shareout-binding="json:revenue">0</span></div>',
      '</body></html>',
    ].join('');
    const response = await handlePublish(
      publishRequest(validBody({ slug: 'ready', files: [{ path: 'index.html', content: html, mime: 'text/html' }] })),
      env,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as ReadinessBody;
    expect(body.editor_readiness?.manifest).toBe('valid');
    expect(body.editor_readiness?.findings).toHaveLength(0);
  });
});
