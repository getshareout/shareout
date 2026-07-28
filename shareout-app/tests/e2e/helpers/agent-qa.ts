import { type Browser, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const AGENT_QA_BASE_URL = process.env.SHAREOUT_E2E_BASE_URL || 'http://localhost:55162';

export interface AgentQaArtifact {
  id: string;
  slug: string;
}

export function readShareOutToken(): string | null {
  const path = process.env.SHAREOUT_CREDENTIALS || join(homedir(), '.shareout', 'credentials');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')).token || null;
  } catch {
    return null;
  }
}

export function agentQaEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@shareout.test`;
}

/** True when the suite is pointed at a local dev worker rather than a real instance. */
function isLocalBaseUrl(): boolean {
  try {
    const { hostname } = new URL(AGENT_QA_BASE_URL);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Mint an API token against a local dev worker, with no credentials on disk.
 *
 * Every spec here used to read `~/.shareout/credentials` and `test.skip` without it, so a
 * contributor cloning the repo ran an e2e suite that skipped everything and still reported
 * green. Locally nothing is needed: `/auth/dev` creates the user and sets a session, and
 * `POST /v1/me/tokens` accepts that session. Both are the paths a first-run self-host uses.
 *
 * Guarded on a localhost base URL — never mint a token against someone's real instance as a
 * side effect of running tests.
 */
export async function bootstrapLocalToken(browser: Browser): Promise<string | null> {
  if (!isLocalBaseUrl()) return null;

  const context = await browser.newContext({ baseURL: AGENT_QA_BASE_URL });
  try {
    const email = agentQaEmail('agent-qa-owner');
    const login = await context.request.get(
      `/auth/dev?email=${encodeURIComponent(email)}&redirect=/`,
      { maxRedirects: 0 }
    );
    // 302 is the success case; /auth/dev 404s off localhost, which the guard above covers.
    if (login.status() !== 302) return null;

    const minted = await context.request.post('/v1/me/tokens', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    if (!minted.ok()) return null;
    return ((await minted.json()) as { token?: string }).token || null;
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

/**
 * Token used by e2e specs.
 *
 * - Localhost / loopback: always mint via `/auth/dev` + `/v1/me/tokens` so a stale
 *   `~/.shareout/credentials` from a hosted instance cannot 401 local publish and
 *   hide real editor bugs. Override only with env `SHAREOUT_CREDENTIALS` (explicit path).
 * - Remote base URL: use credentials file (or SHAREOUT_CREDENTIALS), never auto-mint.
 */
export async function resolveE2eToken(browser: Browser): Promise<string | null> {
  if (process.env.SHAREOUT_CREDENTIALS) {
    return readShareOutToken();
  }
  if (isLocalBaseUrl()) {
    return bootstrapLocalToken(browser);
  }
  return readShareOutToken();
}

export async function publishAgentQaArtifact(
  browser: Browser,
  token: string,
  options: {
    slug: string;
    name: string;
    html: string;
    visibility?: 'private' | 'public' | 'unlisted';
  },
): Promise<AgentQaArtifact> {
  const api = await browser.newContext({ baseURL: AGENT_QA_BASE_URL });
  try {
    const response = await api.request.post('/v1/publish', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        name: options.name,
        slug: options.slug,
        visibility: options.visibility || 'private',
        entrypoint: 'index.html',
        files: [{ path: 'index.html', content: options.html, mime: 'text/html' }],
      },
    });

    if (!response.ok()) {
      throw new Error(`publish failed: ${response.status()} ${await response.text()}`);
    }

    const body = await response.json();
    const id = body?.artifact?.id as string | undefined;
    if (!id) throw new Error(`publish response missing artifact id: ${JSON.stringify(body)}`);

    return { id, slug: options.slug };
  } finally {
    await api.close();
  }
}

export async function addAgentQaCollaborators(
  browser: Browser,
  token: string,
  artifactId: string,
  emails: string[],
  role: 'viewer' | 'editor' = 'viewer',
): Promise<void> {
  const api = await browser.newContext({ baseURL: AGENT_QA_BASE_URL });
  try {
    const response = await api.request.post(`/v1/artifacts/${artifactId}/collaborators`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { emails, role },
    });

    if (!response.ok()) {
      throw new Error(`add collaborators failed: ${response.status()} ${await response.text()}`);
    }
  } finally {
    await api.close();
  }
}

export async function deleteAgentQaArtifact(browser: Browser, token: string, artifactId?: string): Promise<void> {
  if (!artifactId) return;

  const api = await browser.newContext({ baseURL: AGENT_QA_BASE_URL });
  try {
    await api.request.delete(`/v1/artifacts/${artifactId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } finally {
    await api.close();
  }
}

export async function openWithDevLogin(
  browser: Browser,
  email: string,
  redirectPath: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: AGENT_QA_BASE_URL });
  const page = await context.newPage();

  await page.goto(`/auth/dev?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirectPath)}`, {
    waitUntil: 'domcontentloaded',
  });

  return { context, page };
}

export async function waitForTextInAnyFrame(page: Page, text: string, timeoutMs = 30_000): Promise<string> {
  const startedAt = Date.now();
  let lastFrames: Array<{ url: string; text: string }> = [];

  while (Date.now() - startedAt < timeoutMs) {
    const frames: Array<{ url: string; text: string }> = [];
    for (const frame of page.frames()) {
      const bodyText = await frame.locator('body').innerText({ timeout: 1_000 }).catch(() => '');
      frames.push({ url: frame.url(), text: bodyText.slice(0, 500) });
      if (bodyText.includes(text)) return frame.url();
    }
    lastFrames = frames;
    await page.waitForTimeout(500);
  }

  throw new Error(`Timed out waiting for "${text}" in page frames: ${JSON.stringify(lastFrames)}`);
}
