// Artifact Tests — T1 smoke. Renders the artifact in Browser Rendering and checks
// it loads without uncaught JS errors and produces content. Reuses withArtifactPage
// (the same machinery as thumbnails). A null render = harness failure → 'errored',
// never a pass. (Cost note: this opens a browser session; runs are debounced and
// gated on env.BROWSER, not fired on every keystroke-republish.)

import type { Env } from '../types';
import { withArtifactPage } from '../screenshots';
import type { TestResult } from './types';

interface SmokeSignals {
  ready: boolean;
  hasContent: boolean;
  hasSdk: boolean;
}

export async function runSmoke(env: Env, artifactId: string, versionId?: string): Promise<TestResult[]> {
  if (!env.BROWSER) return []; // smoke unavailable here — skip, don't fabricate a pass
  const t0 = Date.now();
  const errors: string[] = [];

  const signals = await withArtifactPage(
    env,
    artifactId,
    { width: 1200, height: 750 },
    { idleTimeout: 8000, settleMs: 800 },
    async (page): Promise<SmokeSignals> => page.evaluate(() => {
      const g = globalThis as Record<string, unknown>;
      const doc = (g as { document?: { body?: { innerText?: string } } }).document;
      const text = doc?.body?.innerText ?? '';
      return {
        ready: g.__shareoutReady === true,
        hasContent: text.trim().length > 0,
        hasSdk: !!g.ShareOut || !!g.so,
      };
    }),
    {
      versionId,
      beforeNavigate: (page) => {
        // Catch load-time errors before navigation.
        page.on('pageerror', (e: Error) => errors.push(e.message || String(e)));
        page.on('console', (msg: { type: () => string; text: () => string }) => {
          if (msg.type() === 'error') errors.push(msg.text());
        });
      },
    },
  );

  // null = render infra failed (browser/deploy/timeout) → errored, not a pass.
  if (signals === null) {
    return [{
      name: 'Artifact renders',
      tier: 'smoke',
      status: 'errored',
      message: 'could not render the artifact (no deployment, render timeout, or browser unavailable)',
      duration_ms: Date.now() - t0,
    }];
  }

  const results: TestResult[] = [];
  results.push({
    name: 'No uncaught JS errors on load',
    tier: 'smoke',
    status: errors.length ? 'failed' : 'passed',
    message: errors.length ? `${errors.length} error(s): ${errors.slice(0, 3).join(' | ').slice(0, 300)}` : 'clean load',
    duration_ms: Date.now() - t0,
  });
  results.push({
    name: 'Artifact rendered content',
    tier: 'smoke',
    status: signals.hasContent ? 'passed' : 'failed',
    message: signals.hasContent ? 'page produced visible content' : 'page rendered blank (no body text)',
    duration_ms: Date.now() - t0,
  });
  // SDK-init is informational — not every artifact uses the SDK.
  results.push({
    name: 'SDK initialised',
    tier: 'smoke',
    status: 'passed',
    message: signals.hasSdk
      ? (signals.ready ? 'SDK present, data marked ready' : 'SDK present')
      : 'no SDK on page (fine for static artifacts)',
    duration_ms: Date.now() - t0,
  });
  return results;
}
