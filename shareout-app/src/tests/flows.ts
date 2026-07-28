// Artifact Tests — T3 e2e flows (Phase 2 Unit B). Drives the artifact in Browser
// Rendering through declarative steps ({visit,click,fill,expect}). Every capture
// render injects a read-only `owner_test` session (see screenshots.ts), so any data
// mutation a flow triggers is blocked by the data router — nothing persists or sends.
// Flows verify render + client interaction, not write→read persistence (read-only
// sandbox; see specs §7, §11).

import type { Env } from '../types';
import { withArtifactPage } from '../screenshots';
import type { FlowSpec, FlowStep, TestResult } from './types';

const STEP_TIMEOUT = 5000;

type Page = Parameters<Parameters<typeof withArtifactPage>[4]>[0];

interface FlowOutcome {
  ok: boolean;
  failedStep?: string;
  error?: string;
}

function label(step: FlowStep): string {
  if ('visit' in step) return `visit ${step.visit}`;
  if ('click' in step) return `click ${step.click}`;
  if ('fill' in step) return `fill ${step.fill[0]}`;
  return `expect ${step.expect.selector ?? step.expect.store ?? step.expect.text ?? ''}`;
}

async function runStep(page: Page, step: FlowStep, origin: string): Promise<string | null> {
  if ('visit' in step) {
    // Self-host only: a flow may navigate within the artifact's own origin, never out.
    const target = new URL(step.visit, page.url());
    if (target.origin !== origin) return 'cross-origin navigation is not allowed in a flow';
    await page.goto(target.toString(), { waitUntil: 'load', timeout: STEP_TIMEOUT });
    return null;
  }
  if ('click' in step) {
    const el = await page.waitForSelector(step.click, { timeout: STEP_TIMEOUT }).catch(() => null);
    if (!el) return `selector not found: ${step.click}`;
    await el.click();
    return null;
  }
  if ('fill' in step) {
    const [selector, value] = step.fill;
    const el = await page.waitForSelector(selector, { timeout: STEP_TIMEOUT }).catch(() => null);
    if (!el) return `selector not found: ${selector}`;
    await el.type(value);
    return null;
  }
  // expect
  const e = step.expect;
  if (e.store) {
    // Store assertions would need a data read mid-flow; not supported by the flow
    // runner yet. Be honest — surface it rather than silently passing.
    return 'store assertions are not supported in flows yet (use a contract assertion)';
  }
  if (e.selector) {
    const el = await page.waitForSelector(e.selector, { timeout: STEP_TIMEOUT }).catch(() => null);
    if (!el) return `expected selector not found: ${e.selector}`;
    if (e.text) {
      const txt = await page.evaluate(
        (s: string) => ((globalThis as { document?: { querySelector(x: string): { textContent?: string } | null } }).document?.querySelector(s)?.textContent) ?? '',
        e.selector,
      );
      if (!String(txt).includes(e.text)) return `expected text "${e.text}" not in ${e.selector}`;
    }
    return null;
  }
  if (e.text) {
    const body = await page.evaluate(() => ((globalThis as { document?: { body?: { innerText?: string } } }).document?.body?.innerText) ?? '');
    if (!String(body).includes(e.text)) return `expected text "${e.text}" not found on page`;
    return null;
  }
  return 'empty expect step (needs selector, text, or store)';
}

/** Run the declarative e2e flows for a version under a read-only sandbox render.
 *  Returns one 'flow' TestResult per flow. errored = the render harness failed
 *  (never a pass); failed = a step assertion failed. Skipped when BROWSER is absent. */
export async function runFlows(
  env: Env,
  artifactId: string,
  versionId: string | undefined,
  flows: FlowSpec[],
): Promise<TestResult[]> {
  if (!env.BROWSER || !flows.length) return [];

  const results: TestResult[] = [];
  for (const flow of flows) {
    const t0 = Date.now();
    const outcome = await withArtifactPage(
      env,
      artifactId,
      { width: 1200, height: 800 },
      { idleTimeout: 8000, settleMs: 600 },
      async (page): Promise<FlowOutcome> => {
        const origin = new URL(page.url()).origin;
        for (const step of flow.steps) {
          let err: string | null;
          try {
            err = await runStep(page, step, origin);
          } catch (e) {
            err = (e as Error)?.message?.slice(0, 160) || 'step threw';
          }
          if (err) return { ok: false, failedStep: label(step), error: err };
        }
        return { ok: true };
      },
      { versionId },
    );

    if (outcome === null) {
      results.push({ name: `flow: ${flow.name}`, tier: 'flow', status: 'errored', message: 'could not render the artifact (browser unavailable or render failed)', duration_ms: Date.now() - t0 });
    } else if (outcome.ok) {
      results.push({ name: `flow: ${flow.name}`, tier: 'flow', status: 'passed', message: `${flow.steps.length} step(s) passed`, duration_ms: Date.now() - t0 });
    } else {
      results.push({ name: `flow: ${flow.name}`, tier: 'flow', status: 'failed', message: `${outcome.failedStep} — ${outcome.error}`, duration_ms: Date.now() - t0 });
    }
  }
  return results;
}
