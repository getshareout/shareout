// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import worker from '../../src/index';
import type { Env } from '../../src/types';
import { JOB_ACTIONS } from '../../src/scheduling/jobs/types';
import embeddedSpec from '../../src/discovery/openapi.spec.json';

const OPENAPI_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs-site/src/openapi/shareout.yaml',
);

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;

interface OpenAPISpec {
  paths: Record<string, Record<string, unknown>>;
}

function loadOperations(): Array<{ method: string; path: string }> {
  const spec = parse(readFileSync(OPENAPI_PATH, 'utf8')) as OpenAPISpec;
  const operations: Array<{ method: string; path: string }> = [];

  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      if (method in item) {
        operations.push({ method: method.toUpperCase(), path });
      }
    }
  }

  return operations;
}

/** Map OpenAPI `{param}` segments to concrete URL segments for routing probes. */
function openApiPathToUrl(path: string): string {
  return path
    .replace(/\{artifactId\}/g, 'art_openapi_contract')
    .replace(/\{id\}/g, 'art_openapi_contract')
    .replace(/\{versionNo\}/g, '1')
    .replace(/\{email\}/g, 'user%40example.com');
}

/** Worker-level miss: handleFetch's ROUTE_NOT_FOUND (plain text off /v1), not a handler body. */
async function isUnrouted404(response: Response): Promise<boolean> {
  if (response.status !== 404) return false;
  const text = await response.text();
  return text === 'Not Found' || text.includes('"ROUTE_NOT_FOUND"');
}

const env = {
  SHAREOUT_BASE_URL: 'https://shareout.example.com',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  SESSION_SECRET: 'session-secret',
  DB: {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return null;
            },
            async all() {
              return { results: [] };
            },
            run: async () => ({}),
          };
        },
      };
    },
  },
} as unknown as Env;

const operations = loadOperations();

describe('OpenAPI contract (shareout.yaml)', () => {
  it('documents at least the core public REST surface', () => {
    expect(operations.length).toBeGreaterThanOrEqual(15);
    expect(operations.some((op) => op.path === '/v1/publish' && op.method === 'POST')).toBe(true);
    expect(operations.some((op) => op.path === '/v1/artifacts' && op.method === 'GET')).toBe(true);
  });

  it('lists every job action the API accepts, and the embedded copy matches the yaml', () => {
    const spec = parse(readFileSync(OPENAPI_PATH, 'utf8')) as { components: { schemas: Record<string, { properties: { action: { enum: string[] } } }> } };
    // JOB_ACTIONS is the only definition the server checks; the docs drifted from it once (#311).
    for (const schema of ['Job', 'JobCreate']) expect(spec.components.schemas[schema].properties.action.enum, schema).toEqual([...JOB_ACTIONS]);
    // Regenerate with `npm run build:discovery` after editing shareout.yaml.
    expect(embeddedSpec).toEqual(spec);
  });

  it.each(operations)('$method $path is routed by the worker (not an unrouted 404)', async ({ method, path }) => {
    const url = openApiPathToUrl(path);
    const response = await worker.fetch(
      new Request(`https://shareout.example.com${url}`, { method }),
      env,
    );

    expect(await isUnrouted404(response)).toBe(false);
  });
});
