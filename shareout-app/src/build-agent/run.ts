/**
 * Entry points the two build integrations share (/v1/create/generate and the assistant's
 * confirmed build): the BUILD_AGENT flag, the metered provider, the page test, and the
 * words a user hears when the agent could not produce a passing page.
 */
import type { Env } from '../types';
import type { AiMeter } from '../data/ai-usage';
import { BUILD_FAILURE_COPY } from '../data/agent/build-page';
import { getCrewProvider } from '../crew/provider';
import { t, type Locale } from '../i18n';
import { agentSummary } from '../verify/report';
import { runVerify } from '../verify/service';
import { ENTRYPOINT } from './page-files';
import { runBuildAgent, type BuildAgentDeps, type BuildAgentResult } from './agent';

/** `BUILD_AGENT=on` turns AI page builds into the tool-using agent. Anything else keeps the one-shot builder. */
export function buildAgentEnabled(env: Env): boolean {
  return (env.BUILD_AGENT ?? '').trim().toLowerCase() === 'on';
}

export interface PageBuildRequest {
  env: Env;
  user: { id: string; email: string | null };
  meter: AiMeter;
  locale: Locale;
  prompt: string;
  /** The page as it is now (index.html text), when changing an existing one. */
  previousHtml?: string;
  isPublic: boolean;
  publish: BuildAgentDeps['publish'];
  onProgress?: (label: string) => void;
}

/** The page test, when this instance has a browser to run it. */
function pageTest(env: Env, user: PageBuildRequest['user']): BuildAgentDeps['verify'] {
  if (!env.BROWSER) return undefined;
  return async (page) => {
    const run = await runVerify(env, { id: user.id, email: user.email, username: null }, page.artifactId, { system: true, refreshThumbnail: false });
    if (!run.ok) return null;
    return { status: run.result.status, errors: run.result.counts.error, text: agentSummary(run.result, run.name) };
  };
}

/** Runs the build agent, or returns null when no AI provider is configured (callers fall back to the one-shot builder). */
export async function runPageBuild(req: PageBuildRequest): Promise<BuildAgentResult | null> {
  const provider = getCrewProvider(req.env);
  if (!provider) return null;
  return runBuildAgent(
    {
      env: req.env,
      provider,
      meter: { ...req.meter, kind: 'page_build' },
      locale: req.locale,
      isPublic: req.isPublic,
      publish: req.publish,
      verify: pageTest(req.env, req.user),
      onProgress: req.onProgress,
    },
    {
      prompt: req.prompt,
      previousFiles: req.previousHtml ? [{ path: ENTRYPOINT, content: req.previousHtml, mime: 'text/html' }] : undefined,
    },
  );
}

/** What to tell the user about a build that did not produce a passing page. */
export function agentFailureText(result: Extract<BuildAgentResult, { ok: false }>, locale: Locale): string {
  const copy = t(locale, BUILD_FAILURE_COPY);
  switch (result.reason) {
    case 'provider_error': return copy.snag;
    case 'budget': return result.detail;
    case 'publish_failed': return result.detail || copy.publishFailed;
    default: return 'draft' in result && result.draft ? copy.gaveUpDraft : copy.gaveUp;
  }
}
