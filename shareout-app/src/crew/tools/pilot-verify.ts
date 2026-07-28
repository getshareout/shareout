import puppeteer from '@cloudflare/puppeteer';
import type { CrewTool } from '../types';
import type { Env } from '../../types';
import { createAccessToken } from '../../token';
import { getPlatformOrigin } from '../../config/origins';

// Verify runs are short and cheap: cap steps low and wall-clock the whole in-page
// run so a stuck agent can never burn budget or hold the browser open.
const MAX_STEPS_DEFAULT = 6;
const MAX_STEPS_CAP = 8;
const RUN_TIMEOUT_MS = 90_000;
const NAV_TIMEOUT_MS = 20_000;
const CAPTURE_TTL_SEC = 300;
const SESSION_TTL_SEC = 60 * 10;

function clampSteps(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : MAX_STEPS_DEFAULT;
  return Math.min(MAX_STEPS_CAP, Math.max(1, n));
}

/** Resolve the target artifact and confirm the crew's owner scope may access it. */
async function resolveOwnedArtifact(
  env: Env,
  artifactId: string,
  ownerId: string,
  workspaceId: string,
): Promise<{ slug: string } | { error: string }> {
  const row = await env.DB.prepare(
    `SELECT d.slug AS slug, a.owner_id AS owner_id, a.workspace_id AS workspace_id
       FROM deployments d
       JOIN artifacts a ON a.id = d.artifact_id
      WHERE d.artifact_id = ? AND d.channel = 'production'`
  ).bind(artifactId).first<{ slug: string; owner_id: string | null; workspace_id: string | null }>();

  if (!row?.slug) return { error: 'Artifact has no production deployment to verify.' };
  // A crew acts as the artifact owner. It may only verify artifacts that owner owns,
  // or that live in the crew's workspace — never an arbitrary id.
  const owns = row.owner_id === ownerId;
  const sameWorkspace = !!workspaceId && row.workspace_id === workspaceId;
  if (!owns && !sameWorkspace) {
    return { error: 'This crew cannot access the requested artifact.' };
  }
  return { slug: row.slug };
}

// Runs INSIDE the headless page. Ensures the page-pilot bundle is present, reads the
// owner session token injected by the capture serve path, and constructs the pilot
// agent with a customFetch that forwards that token so the pilot LLM proxy
// (handlePilot) authenticates as the owner (skipping the pilot_enabled gate) and
// bills the owner's workspace. Bounded by maxSteps AND the outer wall-clock timeout.
// NOTE: this runs in the headless browser, not the Worker — DOM globals aren't in
// the Worker's TS lib, so reach them through `globalThis` (matches screenshots.ts).
async function driveInPage(task: string, maxSteps: number): Promise<{ success: boolean; data: string; steps: number }> {
  const g = globalThis as any;
  const PagePilot = g.PagePilot;
  if (!PagePilot?.PageAgent) {
    return { success: false, data: 'pilot engine not available in page', steps: 0 };
  }

  // Session token minted by serveCaptureView (capture_verify → writable owner). The
  // page-agent's own fetch would send `Bearer proxy`; we override it with the owner
  // session so the proxy resolves ctx.isOwner === true.
  const dataEl = g.document?.getElementById('shareout-initial-data');
  let sessionToken = '';
  let baseUrl = g.location?.origin || '';
  let artifactId = '';
  try {
    const init = JSON.parse(dataEl?.textContent || '{}') as { sessionToken?: string; baseUrl?: string; artifactId?: string };
    sessionToken = init.sessionToken || '';
    baseUrl = init.baseUrl || baseUrl;
    artifactId = init.artifactId || '';
  } catch {
    /* fall through — no token means the proxy will 403, surfaced as failure */
  }
  if (!sessionToken || !artifactId) {
    return { success: false, data: 'owner session missing in page', steps: 0 };
  }

  const taskId = (g.crypto?.randomUUID?.() || `verify-${Date.now()}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  const agent = new PagePilot.PageAgent({
    model: 'proxy',
    apiKey: 'proxy',
    baseURL: `${baseUrl}/v1/data/${artifactId}/agent/pilot`,
    language: 'en-US',
    maxSteps,
    stepDelay: 0.3,
    customFetch: (url: any, cfgInit: any) => {
      const headers = new g.Headers(cfgInit?.headers);
      headers.set('Authorization', `Bearer ${sessionToken}`);
      headers.set('x-pilot-task', taskId);
      return g.fetch(url, { ...cfgInit, headers });
    },
  });
  // Expose for the outer wall-clock timeout to stop a stuck run.
  g.__soPilotAgent = agent;
  agent.panel?.hide();

  try {
    const result = await agent.execute(task);
    const steps = agent.history.filter((e: { type: string }) => e.type === 'step').length;
    return { success: !!result.success, data: String(result.data ?? ''), steps };
  } finally {
    try { agent.dispose(); } catch { /* noop */ }
  }
}

export const pilotVerifyTool: CrewTool = {
  name: 'pilot_verify',
  mode: 'write',
  defaultApproval: 'never',
  description:
    'Open a published artifact in a headless browser and run the Page Pilot GUI agent against its real UI to verify a behavior — e.g. "confirm the Add-Order form still submits" or "check the filter updates the chart". Returns { success, data, steps }. Short and cheap (maxSteps 1..8, default 6). Use for UI-level regression checks the data plane cannot see. The in-page LLM calls bill the owner workspace automatically.',
  input_schema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'The artifact id to verify (must be owned by / in this crew\'s workspace).' },
      task: { type: 'string', description: 'Natural-language UI task to verify, e.g. "submit the Add Order form and confirm a success message".' },
      maxSteps: { type: 'number', description: 'Max pilot steps (1..8, default 6). Keep low — verify runs should be quick.' },
    },
    required: ['artifactId', 'task'],
  },
  async execute(ctx, input) {
    const env = ctx.data.env;
    // Graceful when Browser Rendering is unbound (mirrors screenshots.ts).
    if (!env.BROWSER) {
      return { success: false, error: 'Browser Rendering not available', data: '' };
    }

    const artifactId = typeof input.artifactId === 'string' ? input.artifactId : '';
    const task = typeof input.task === 'string' ? input.task.trim() : '';
    if (!artifactId) return { success: false, error: 'Missing required field "artifactId".', data: '' };
    if (!task) return { success: false, error: 'Missing required field "task".', data: '' };
    const maxSteps = clampSteps(input.maxSteps);

    const resolved = await resolveOwnedArtifact(
      env, artifactId, ctx.principal.ownerId, ctx.principal.workspaceId,
    );
    if ('error' in resolved) return { success: false, error: resolved.error, data: '' };

    const base = getPlatformOrigin(env);
    // capture_verify: bare, un-sandboxed HTML at top-level with a WRITABLE owner
    // session injected (serveCaptureView), so the in-page SDK + pilot proxy act as
    // the owner and the run can actually submit forms.
    const captureToken = await createAccessToken(artifactId, 'capture_verify', env, CAPTURE_TTL_SEC);
    const url = `${base}/a/${resolved.slug}/?_capture=${encodeURIComponent(captureToken)}`;

    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
      browser = await puppeteer.launch(env.BROWSER as Parameters<typeof puppeteer.launch>[0]);
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });

      // The SDK (window.so) is only present if the artifact loads it. Ensure the core
      // SDK + page-pilot bundle exist so the pilot can run regardless of the artifact.
      await page.addScriptTag({ url: `${base}/sdk/shareout.js` }).catch(() => {});
      await page.addScriptTag({ url: `${base}/sdk/page-pilot.js` }).catch(() => {});
      // Settle briefly so the artifact's own data/UI paints before we drive it.
      await new Promise((r) => setTimeout(r, 800));

      const run = page.evaluate(driveInPage, task, maxSteps) as Promise<{ success: boolean; data: string; steps: number }>;
      const timeout = new Promise<{ timedOut: true }>((r) => setTimeout(() => r({ timedOut: true }), RUN_TIMEOUT_MS));
      const outcome = await Promise.race([run, timeout]);

      if ('timedOut' in outcome) {
        await page.evaluate(() => {
          const g = globalThis as any;
          return g.__soPilotAgent?.stop?.();
        }).catch(() => {});
        return { success: false, data: 'timed out', steps: 0 };
      }
      return { success: outcome.success, data: outcome.data, steps: outcome.steps };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'pilot verify failed', data: '' };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  },
};

// Exposed for unit tests; not part of the request-handling surface.
export const _internal = { clampSteps, resolveOwnedArtifact, MAX_STEPS_CAP, MAX_STEPS_DEFAULT };
