/**
 * Test fixtures and env factory for `handleServe*` integration tests.
 *
 * `createServeEnv` builds a minimal Env with mocked D1, R2, KV, and edge cache
 * bindings so serve handlers can be exercised without a live Cloudflare stack.
 */
import { vi } from 'vitest';
import type { Env } from '../../../../src/types';
import { miniDbBinding } from '../../helpers/minidb-mock';

export const BASE_URL = 'https://shareout.example.com';
export const SLUG = 'demo-app';
export const VERSION_ID = 'ver_1';
export const ARTIFACT_ID = 'art_1';

/** Default deployment row returned by the combined deployment+asset query. */
export const defaultDeployment = {
  version_id: VERSION_ID,
  entrypoint: 'index.html',
  mobile_entrypoint: 'mobile/index.html',
  artifact_id: ARTIFACT_ID,
  artifact_name: 'Demo App',
  visibility: 'public' as const,
  auth_method: 'google' as const,
  owner_id: 'usr_1',
  // Paid owner → no "Made with ShareOut" badge, so the raw/cmt cache-variant and
  // ETag assertions below stay deterministic (the badge has its own test).
  owner_tier: 'team',
  paused: 0,
  has_mobile: 1,
  pwa_config: null as string | null,
  access_policy: null as string | null,
  manifest_json: null as string | null,
  moderation_status: 'approved' as string,
  moderation_held_visibility: null as string | null,
  r2_key: 'artifacts/demo/index.html',
  mime: 'text/html',
  size_bytes: 512,
};

export interface ServeScenario {
  deployment?: typeof defaultDeployment | null;
  cachedDeployment?: Omit<typeof defaultDeployment, 'r2_key' | 'mime' | 'size_bytes'> | null;
  embedDeployment?: (typeof defaultDeployment & { embed_allowed: number; embed_origins: string | null }) | null;
  assets?: Record<string, { r2_key: string; mime: string; size_bytes: number }>;
  r2?: Record<string, { body: string | ReadableStream; range?: { offset: number; length: number }; httpMetadata?: { cacheControl?: string } }>;
  manifestJson?: string | null;
  initialJsonRows?: Array<{ key: string; value: string }>;
  initialTables?: Array<{ id: string; name: string; row_count: number; rows?: string[] }>;
  namespaced?: {
    workspaceSlug: string;
    artifactSlug: string;
    deploySlug: string;
    folderPath?: string;
    folderChain?: Array<{ slug: string; parent_id: string | null }>;
    artifactFolderId?: string | null;
  } | null;
  sessionUser?: { email: string } | null;
  accessTokenValid?: boolean;
  ownerMatch?: boolean;
  collaborator?: { role: string } | null;
  artifactWorkspaceId?: string | null;
  workspaceMemberRole?: string | null;
  throwOnManifest?: boolean;
  throwOnInitialJson?: boolean;
  throwOnInitialTables?: boolean;
}

/** Build a synthetic asset row for manifest/preload tests. */
export function assetsEntry(path: string) {
  return {
    r2_key: `artifacts/demo/${path}`,
    mime: path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'application/javascript' : 'text/html',
    size_bytes: 128,
  };
}

export function createServeEnv(scenario: ServeScenario = {}) {
  const deployment = scenario.deployment === undefined ? defaultDeployment : scenario.deployment;
  const cachedDeployment = scenario.cachedDeployment ?? null;
  const assets = scenario.assets ?? {
    'index.html': {
      r2_key: 'artifacts/demo/index.html',
      mime: 'text/html',
      size_bytes: 512,
    },
    'mobile/index.html': {
      r2_key: 'artifacts/demo/mobile/index.html',
      mime: 'text/html',
      size_bytes: 400,
    },
    'app.js': {
      r2_key: 'artifacts/demo/app.js',
      mime: 'application/javascript',
      size_bytes: 2048,
    },
    'style.css': {
      r2_key: 'artifacts/demo/style.css',
      mime: 'text/css',
      size_bytes: 1024,
    },
    'logo.png': {
      r2_key: 'artifacts/demo/logo.png',
      mime: 'image/png',
      size_bytes: 4096,
    },
  };

  const r2Store = scenario.r2 ?? {
    'artifacts/demo/index.html': { body: '<html><body><h1>Hello</h1><script>alert(1)</script></body></html>' },
    'artifacts/demo/mobile/index.html': { body: '<html><body>Mobile</body></html>' },
    'artifacts/demo/app.js': { body: 'console.log("ok");' },
    'artifacts/demo/style.css': { body: 'body { color: red; }' },
    'artifacts/demo/logo.png': { body: 'fake-png-bytes' },
  };

  const slugsStore = new Map<string, string>();
  if (cachedDeployment) {
    slugsStore.set(`deploy:${SLUG}`, JSON.stringify(cachedDeployment));
  }

  const env = {
    SHAREOUT_BASE_URL: BASE_URL,
    SESSION_SECRET: 'session-secret',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    SLUGS: {
      get: vi.fn(async (key: string, type?: string) => {
        const raw = slugsStore.get(key);
        if (!raw) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      }),
      put: vi.fn(async (key: string, value: string) => {
        slugsStore.set(key, value);
      }),
    },
    ARTIFACTS: {
      get: vi.fn(async (key: string, options?: { range?: { offset: number; length: number } }) => {
        const entry = r2Store[key];
        if (!entry) return null;
        const body = typeof entry.body === 'string'
          ? new ReadableStream({
              start(controller) {
                const bytes = new TextEncoder().encode(entry.body);
                const slice = options?.range
                  ? bytes.slice(options.range.offset, options.range.offset + options.range.length)
                  : bytes;
                controller.enqueue(slice);
                controller.close();
              },
            })
          : entry.body;

        return {
          body,
          text: async () => (typeof entry.body === 'string' ? entry.body : ''),
          range: options?.range ?? entry.range,
          httpMetadata: entry.httpMetadata,
        };
      }),
    },
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...bindArgs: unknown[]) => ({
          first: vi.fn(async () => {
            if (scenario.namespaced && sql.includes('workspaces w') && sql.includes('deploy_slug')) {
              if (!scenario.namespaced) return null;
              return {
                ...defaultDeployment,
                deploy_slug: scenario.namespaced.deploySlug,
                workspace_slug: scenario.namespaced.workspaceSlug,
              };
            }

            if (sql.includes('SELECT folder_id, workspace_id FROM artifacts')) {
              return {
                folder_id: scenario.namespaced?.artifactFolderId ?? null,
                workspace_id: 'ws_1',
              };
            }

            if (sql.includes('SELECT slug, parent_id FROM folders')) {
              const folderId = bindArgs[0];
              const chain = scenario.namespaced?.folderChain ?? [];
              const idx = chain.findIndex((_f, i) => `folder_${i}` === folderId || bindArgs[0] === folderId);
              if (idx >= 0) return chain[idx];
              if (chain.length > 0 && folderId === 'folder_leaf') return chain[chain.length - 1];
              return null;
            }

            if (sql.includes('FROM deployments d') && sql.includes('embed_allowed')) {
              const embed = scenario.embedDeployment;
              if (!embed) return null;
              const targetPath = bindArgs[0] as string | null;
              const resolvedPath = targetPath || embed.entrypoint;
              const asset = assets[resolvedPath];
              return {
                ...embed,
                r2_key: asset?.r2_key ?? embed.r2_key ?? null,
                mime: asset?.mime ?? embed.mime ?? null,
                size_bytes: asset?.size_bytes ?? embed.size_bytes ?? null,
              };
            }

            if (sql.includes('FROM deployments d') && sql.includes('LEFT JOIN assets ast')) {
              if (!deployment) return null;
              let resolvedPath: string;
              // Match the bound-path marker exactly: the SELECT list carries other
              // COALESCEs now (satellite defaults), and a bare `includes('COALESCE')`
              // would read the slug as if it were the requested path.
              if (sql.includes('COALESCE(?, v.entrypoint)')) {
                resolvedPath = (bindArgs[0] as string | null) || deployment.entrypoint;
              } else {
                resolvedPath = deployment.entrypoint;
              }
              const asset = assets[resolvedPath];
              return {
                ...deployment,
                manifest_json: scenario.manifestJson ?? deployment.manifest_json ?? null,
                r2_key: asset?.r2_key ?? null,
                mime: asset?.mime ?? null,
                size_bytes: asset?.size_bytes ?? null,
              };
            }

            if (sql.includes('SELECT r2_key, mime, size_bytes FROM assets')) {
              if (sql.includes("path = 'index.html'")) {
                return assets['index.html'] ?? null;
              }
              const path = bindArgs[1] as string;
              return assets[path] ?? null;
            }

            if (sql.includes('SELECT r2_key, mime FROM assets')) {
              const path = bindArgs[1] as string;
              const asset = assets[path];
              return asset ? { r2_key: asset.r2_key, mime: asset.mime } : null;
            }

            if (sql.includes('SELECT manifest_json FROM versions')) {
              if (scenario.throwOnManifest) {
                throw new Error('db unavailable');
              }
              return scenario.manifestJson ? { manifest_json: scenario.manifestJson } : null;
            }

            if (sql.includes('SELECT r2_key FROM assets WHERE version_id')) {
              const path = bindArgs[1] as string;
              return assets[path] ? { r2_key: assets[path].r2_key } : null;
            }

            if (sql.includes('SELECT owner_id FROM artifacts WHERE id')) {
              return { owner_id: 'usr_1' };
            }

            if (sql.includes('SELECT 1 FROM users WHERE id')) {
              return scenario.ownerMatch ? { 1: 1 } : null;
            }

            if (sql.includes('SELECT role FROM collaborators')) {
              return scenario.collaborator ?? null;
            }

            if (sql.includes('SELECT workspace_id FROM artifacts WHERE id')) {
              return { workspace_id: scenario.artifactWorkspaceId ?? null };
            }

            if (sql.includes('FROM workspace_members')) {
              return scenario.workspaceMemberRole ? { role: scenario.workspaceMemberRole } : null;
            }

            return null;
          }),
          all: vi.fn(async () => {
            if (sql.includes('FROM artifact_json')) {
              if (scenario.throwOnInitialJson) {
                throw new Error('json unavailable');
              }
              return { results: scenario.initialJsonRows ?? [] };
            }
            if (sql.includes('FROM artifact_tables')) {
              if (scenario.throwOnInitialTables) {
                throw new Error('tables unavailable');
              }
              return { results: scenario.initialTables ?? [] };
            }
            if (sql.includes('SELECT data FROM artifact_rows')) {
              const tableId = bindArgs[0];
              const table = (scenario.initialTables ?? []).find(t => t.id === tableId);
              return {
                results: (table?.rows ?? []).map(data => ({ data })),
              };
            }
            if (sql.includes('criticalAssets') || (sql.includes('SELECT path, mime FROM assets') && sql.includes('LIMIT 10'))) {
              return {
                results: [
                  { path: 'style.css', mime: 'text/css' },
                  { path: 'theme.woff2', mime: 'font/woff2' },
                ],
              };
            }
            return { results: [] };
          }),
          run: vi.fn(async () => ({ success: true })),
        })),
      })),
    },
  } as unknown as Env;

  (env as { MINIDB: unknown }).MINIDB = miniDbBinding(env.DB as unknown as Parameters<typeof miniDbBinding>[0]);

  return { env, slugsStore, r2Store };
}

export function serveRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE_URL}/a/${SLUG}/${path}`, init);
}

export async function readStreamResponse(response: Response): Promise<string> {
  return response.text();
}
