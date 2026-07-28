/**
 * Index router test suite: subdomain routing.
 * Registered from `index.test.ts` so Vitest hoists `vi.mock` in the entry file.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HandlerMocks } from '../handlers';
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

export function registerSubdomainRoutingTests(handlers: HandlerMocks): void {
describe('index router — subdomain routing', () => {
  it('serves the data API on workspace subdomains (same-origin)', async () => {
    const response = await fetchPath('/v1/artifacts', authed(), SUB);
    expect(await handlerTag(response)).toBe('handleListArtifacts');
  });

  it('serves auth routes on workspace subdomains (login works there)', async () => {
    const response = await fetchPath('/auth/google', undefined, SUB);
    expect(response.status).toBe(302);
    expect(handlers.handleGoogleLogin).toHaveBeenCalled();
  });

  it('serves the SDK on workspace subdomains', async () => {
    const response = await fetchPath('/sdk/shareout.js', undefined, SUB);
    expect(await handlerTag(response)).toBe('handleServeSDK');
  });

  it('passes apex-style /a/<slug>/ URLs through on workspace subdomains', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('JOIN deployments')) return { deploy_slug: 'deploy-slug' };
      return null;
    });
    const response = await fetchPath('/a/deploy-slug/index.html', undefined, SUB, env);
    expect(await handlerTag(response)).toBe('handleServe');
  });

  it('redirects an anonymous subdomain visitor to sign in (private)', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('FROM workspaces WHERE slug')) {
        return { id: 'ws_1', name: 'Acme', description: 'Demo workspace' };
      }
      return null;
    });
    const response = await fetchPath('/workspace', undefined, SUB, env);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/auth/login?redirect=/');
  });

  it('redirects a signed-in member to the workspace dashboard', async () => {
    handlers.getSessionUser.mockResolvedValueOnce({ id: 'usr_1', email: 'm@acme.com' });
    const env = createEnv((sql) => {
      if (sql.includes('FROM workspaces WHERE slug')) {
        return { id: 'ws_1', name: 'Acme', description: null };
      }
      if (sql.includes('identity_id FROM users')) return { identity_id: null };
      if (sql.includes('FROM workspace_members')) return { '1': 1 };
      return null;
    });
    const response = await fetchPath('/', undefined, SUB, env);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/home?workspace=ws_1');
  });

  it('shows an access page to a signed-in non-member', async () => {
    handlers.getSessionUser.mockResolvedValueOnce({ id: 'usr_1', email: 'x@other.com' });
    const env = createEnv((sql) => {
      if (sql.includes('FROM workspaces WHERE slug')) {
        return { id: 'ws_1', name: 'Acme', description: null };
      }
      if (sql.includes('identity_id FROM users')) return { identity_id: null };
      if (sql.includes('FROM workspace_members')) return null;
      return null;
    });
    const response = await fetchPath('/', undefined, SUB, env);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('is private');
  });

  it('serves subdomain artifact paths via handleSubdomainServe', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('FROM workspaces WHERE slug')) {
        return { id: 'ws_1', name: 'Acme', description: null };
      }
      if (sql.includes('JOIN deployments')) {
        return { deploy_slug: 'deploy-slug' };
      }
      return null;
    });
    const response = await fetchPath('/my-app/index.html', undefined, SUB, env);
    expect(await handlerTag(response)).toBe('handleServe');
    expect(handlers.handleServe).toHaveBeenCalled();
  });

  it('falls back to namespaced serve when deploy slug missing', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('FROM workspaces WHERE slug')) {
        return { id: 'ws_1', name: 'Acme', description: null };
      }
      return null;
    });
    const response = await fetchPath('/other-app/', undefined, SUB, env);
    expect(await handlerTag(response)).toBe('handleServeNamespaced');
  });

  it('returns workspace not found on subdomain when slug missing', async () => {
    const response = await fetchPath('/workspace', undefined, SUB, createEnv());
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain('Workspace not found');
    expect(body).toContain('nf-wrap');
  });

  it('returns workspace not found on subdomain root when slug missing', async () => {
    const response = await fetchPath('/', undefined, SUB, createEnv());
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain('Workspace not found');
    expect(body).toContain('nf-wrap');
  });

  it('does not publicly list a workspace on the apex /workspace/<slug> — redirects to the gated subdomain', async () => {
    const response = await fetchPath('/workspace/beta/', undefined, APEX);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://beta.shareout.example.com/workspace/');
  });

  it('treats reserved subdomains as apex', async () => {
    const response = await fetchPath('/health', undefined, 'https://www.shareout.example.com');
    expect(response.status).toBe(200);
  });
});
}
