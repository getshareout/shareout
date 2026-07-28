import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { handleGetSkill, handleGetSkillVersion, handleGetSkillMeta, handleGetSkillFile, SKILL_BUNDLE_KEY } from '../../src/skill';
import type { Env } from '../../src/types';

const SKILL_VERSION = '1.5.0';
const SKILL_UPDATED_AT = '2025-05-29T00:00:00Z';

const META = {
  name: 'shareout-skill',
  version: SKILL_VERSION,
  updated_at: SKILL_UPDATED_AT,
  description: 'Publish and manage ShareOut HTML artifacts',
};
const SKILL_MD = [
  '---',
  'name: "shareout-skill"',
  '---',
  '',
  'Use POST /v1/publish to publish.',
  'Full URL: https://shareout.site/v1/publish',
  'Workspace subdomain: acme.shareout.site',
  'Artifacts run on {hex}.shareoutcdn.site',
  '',
].join('\n');
const TEAM_SKILL_MD = '---\nname: "shareout-teams-skill"\n---\n\nTeams workspace administration.\n';
const INDEX_MD = [
  '| **Authentication** | auth |',
  '| **API Reference** | api |',
  '| **Scheduling API** | jobs |',
  '| **CORS Proxy API** | proxy |',
  '| **Google Sheets Integration** | sheets |',
  '| **Shopify Integration** | shopify |',
  '| **SDK Reference** | sdk |',
  '| **Examples** | examples |',
].join('\n');

const SKILL_BUNDLE = zipSync({
  'SKILL.md': new TextEncoder().encode(SKILL_MD),
  'INDEX.md': new TextEncoder().encode(INDEX_MD),
  'team/SKILL.md': new TextEncoder().encode(TEAM_SKILL_MD),
});

const bundleBuffer = (): ArrayBuffer =>
  SKILL_BUNDLE.buffer.slice(
    SKILL_BUNDLE.byteOffset,
    SKILL_BUNDLE.byteOffset + SKILL_BUNDLE.byteLength,
  ) as ArrayBuffer;

/**
 * @param overrides R2 keys to replace (set to `undefined` to simulate a miss).
 * @param opts `assets` stages the build-time fallback bundle; `vars` sets Env vars.
 */
function makeEnv(
  overrides: Record<string, unknown> = {},
  opts: { assets?: boolean; vars?: Record<string, string> } = {},
): Env {
  const files: Record<string, unknown> = {
    'skill/_meta.json': { json: async () => META, text: async () => JSON.stringify(META), body: JSON.stringify(META) },
    'skill/SKILL.md': { json: async () => ({}), text: async () => SKILL_MD, body: SKILL_MD },
    'skill/INDEX.md': { json: async () => ({}), text: async () => INDEX_MD, body: INDEX_MD },
    'skill/team/SKILL.md': { json: async () => ({}), text: async () => TEAM_SKILL_MD, body: TEAM_SKILL_MD },
    [SKILL_BUNDLE_KEY]: {
      json: async () => ({}),
      text: async () => '',
      body: SKILL_BUNDLE,
      arrayBuffer: bundleBuffer,
    },
    ...overrides,
  };

  // The Workers Static Assets binding: present only when the caller asks for it,
  // so "no R2 and no asset" stays a reachable 404 case.
  const assets = {
    fetch: async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      if (!opts.assets) return new Response('not found', { status: 404 });
      if (path === '/_bundles/skill.zip') return new Response(bundleBuffer(), { status: 200 });
      if (path === '/_bundles/skill-meta.json') return new Response(JSON.stringify(META), { status: 200 });
      return new Response('not found', { status: 404 });
    },
  };

  return {
    ...opts.vars,
    ARTIFACTS: { get: async (key: string) => files[key] ?? null },
    ASSETS: assets,
  } as unknown as Env;
}

/** An instance with no R2 skill copy at all — a fresh self-hosted deploy. */
function makeAssetOnlyEnv(vars: Record<string, string> = {}): Env {
  return makeEnv(
    {
      'skill/_meta.json': undefined,
      'skill/SKILL.md': undefined,
      'skill/INDEX.md': undefined,
      'skill/team/SKILL.md': undefined,
      [SKILL_BUNDLE_KEY]: undefined,
    },
    { assets: true, vars },
  );
}

function expectSkillHeaders(response: Response, contentType: string, expectDisposition = false): void {
  expect(response.headers.get('Content-Type')).toBe(contentType);
  expect(response.headers.get('X-Skill-Version')).toBe(SKILL_VERSION);
  expect(response.headers.get('X-Skill-Updated-At')).toBe(SKILL_UPDATED_AT);
  expect(response.headers.get('ETag')).toBe(`"${SKILL_VERSION}"`);
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
    'X-Skill-Version, X-Skill-Updated-At, ETag, Content-Disposition',
  );
  if (expectDisposition) {
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="shareout-skill-${SKILL_VERSION}.zip"`,
    );
  }
}

describe('skill handlers', () => {
  describe('handleGetSkill', () => {
    it('returns the full skill zip on GET', async () => {
      const response = await handleGetSkill(
        new Request('https://shareout.example.com/v1/skill', { method: 'GET' }),
        makeEnv(),
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      const entries = unzipSync(bytes);

      expect(response.status).toBe(200);
      expectSkillHeaders(response, 'application/zip', true);
      expect(new TextDecoder().decode(entries['SKILL.md'])).toContain('name: "shareout-skill"');
      expect(new TextDecoder().decode(entries['SKILL.md'])).toContain('POST /v1/publish');
      expect(new TextDecoder().decode(entries['INDEX.md'])).toContain('Authentication');
    });

    it('returns headers only on HEAD', async () => {
      const response = await handleGetSkill(
        new Request('https://shareout.example.com/v1/skill', { method: 'HEAD' }),
        makeEnv(),
      );

      expect(response.status).toBe(200);
      expectSkillHeaders(response, 'application/zip', true);
      expect(await response.text()).toBe('');
    });

    it('returns 304 when If-None-Match matches version', async () => {
      const response = await handleGetSkill(
        new Request('https://shareout.example.com/v1/skill', {
          method: 'GET',
          headers: { 'If-None-Match': `"${SKILL_VERSION}"` },
        }),
        makeEnv(),
      );

      expect(response.status).toBe(304);
      expectSkillHeaders(response, 'application/zip', true);
      expect(await response.text()).toBe('');
    });

    it('returns full body when If-None-Match does not match', async () => {
      const response = await handleGetSkill(
        new Request('https://shareout.example.com/v1/skill', {
          method: 'GET',
          headers: { 'If-None-Match': '"old-version"' },
        }),
        makeEnv(),
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      const entries = unzipSync(bytes);

      expect(response.status).toBe(200);
      expect(new TextDecoder().decode(entries['SKILL.md'])).toContain('name: "shareout-skill"');
    });

    it('injects workspace-context.md when workspace context is provided', async () => {
      const response = await handleGetSkill(
        new Request('https://shareout.example.com/v1/skill', { method: 'GET' }),
        makeEnv(),
        '# Workspace context\n\nUse the blue palette.',
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      const entries = unzipSync(bytes);

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
      expect(new TextDecoder().decode(entries['workspace-context.md'])).toContain('Use the blue palette');
      expect(new TextDecoder().decode(entries['SKILL.md'])).toContain('POST /v1/publish');
    });

    it('returns 404 when the bundle is missing from both R2 and the staged asset', async () => {
      const response = await handleGetSkill(
        new Request('https://shareout.example.com/v1/skill', { method: 'GET' }),
        makeEnv({ [SKILL_BUNDLE_KEY]: undefined }),
      );
      expect(response.status).toBe(404);
    });

    // A fresh self-hosted deploy has nothing in R2 — only the founder instance runs
    // the R2 skill sync. Without the staged asset `/v1/skill` 404s, which is the one
    // endpoint the deploy docs promise works out of the box.
    it('falls back to the staged asset when R2 has no skill copy', async () => {
      const response = await handleGetSkill(
        new Request('https://acme.workers.dev/v1/skill', { method: 'GET' }),
        makeAssetOnlyEnv(),
      );
      const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

      expect(response.status).toBe(200);
      expect(response.headers.get('X-Skill-Version')).toBe(SKILL_VERSION);
      expect(new TextDecoder().decode(entries['SKILL.md'])).toContain('POST /v1/publish');
    });

    it('rewrites founder-host URLs in the zip to this instance origin', async () => {
      const response = await handleGetSkill(
        new Request('https://acme.workers.dev/v1/skill', { method: 'GET' }),
        makeAssetOnlyEnv({ SHAREOUT_BASE_URL: 'https://acme.workers.dev' }),
      );
      const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
      const md = new TextDecoder().decode(entries['SKILL.md']);

      expect(md).toContain('https://acme.workers.dev/v1/publish');
      expect(md).toContain('acme.acme.workers.dev'); // subdomain example follows the instance
      expect(md).not.toContain('shareout.site');
    });

    it('leaves the bundle byte-identical on the founder host', async () => {
      const response = await handleGetSkill(
        new Request('https://shareout.site/v1/skill', { method: 'GET' }),
        makeEnv({}, { vars: { SHAREOUT_BASE_URL: 'https://shareout.site' } }),
      );
      const bytes = new Uint8Array(await response.arrayBuffer());

      expect(bytes).toEqual(SKILL_BUNDLE);
    });

    it('rewrites and injects workspace context in the same pass', async () => {
      const response = await handleGetSkill(
        new Request('https://acme.workers.dev/v1/skill', { method: 'GET' }),
        makeAssetOnlyEnv({ SHAREOUT_BASE_URL: 'https://acme.workers.dev' }),
        '# Workspace context\n\nUse the blue palette.',
      );
      const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

      expect(new TextDecoder().decode(entries['workspace-context.md'])).toContain('blue palette');
      expect(new TextDecoder().decode(entries['SKILL.md'])).toContain('https://acme.workers.dev/v1/publish');
    });
  });

  describe('handleGetSkillVersion', () => {
    it('returns version JSON', async () => {
      const response = await handleGetSkillVersion(makeEnv());
      const body = await response.json() as { version: string; updated_at: string };

      expect(response.status).toBe(200);
      expectSkillHeaders(response, 'application/json');
      expect(body).toEqual({ version: SKILL_VERSION, updated_at: SKILL_UPDATED_AT });
    });
  });

  describe('handleGetSkillMeta', () => {
    it('returns skill metadata JSON', async () => {
      const response = await handleGetSkillMeta(makeEnv());
      const body = await response.json() as {
        name: string;
        version: string;
        updated_at: string;
        description: string;
        format: string;
        endpoints: Record<string, string>;
        sections: string[];
        version_check: { description: string; methods: string[] };
      };

      expect(response.status).toBe(200);
      expectSkillHeaders(response, 'application/json');
      expect(body.name).toBe('shareout-skill');
      expect(body.version).toBe(SKILL_VERSION);
      expect(body.updated_at).toBe(SKILL_UPDATED_AT);
      expect(body.description).toContain('ShareOut HTML artifacts');
      expect(body.format).toBe('zip');
      expect(body.endpoints).toEqual({
        full: 'GET /v1/skill',
        version: 'GET /v1/skill/version',
        meta: 'GET /v1/skill/meta',
        file: 'GET /v1/skill/{path}',
      });
      expect(body.sections).toEqual([
        'Authentication',
        'API Reference',
        'Scheduling API',
        'CORS Proxy API',
        'Google Sheets Integration',
        'Shopify Integration',
        'SDK Reference',
        'Examples',
      ]);
      expect(body.version_check.description).toContain('latest skill version');
      expect(body.version_check.methods).toHaveLength(3);
    });
  });

  describe('handleGetSkillFile', () => {
    it('resolves /v1/skill/team to the Teams overlay entrypoint', async () => {
      const response = await handleGetSkillFile('team', makeEnv());
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/markdown');
      expect(text).toContain('name: "shareout-teams-skill"');
    });

    it('reads a single file out of the staged asset when R2 is empty', async () => {
      const response = await handleGetSkillFile('SKILL.md', makeAssetOnlyEnv());

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('POST /v1/publish');
    });

    it('rewrites the founder host in single-file reads', async () => {
      const response = await handleGetSkillFile(
        'SKILL.md',
        makeAssetOnlyEnv({ SHAREOUT_BASE_URL: 'https://acme.workers.dev' }),
      );
      const text = await response.text();

      expect(text).toContain('https://acme.workers.dev/v1/publish');
      expect(text).not.toContain('shareout.site');
    });

    it('404s when the file exists in neither R2 nor the staged asset', async () => {
      const response = await handleGetSkillFile('nope/missing.md', makeAssetOnlyEnv());
      expect(response.status).toBe(404);
    });
  });
});
