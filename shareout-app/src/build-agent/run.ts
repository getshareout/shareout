/**
 * Entry points the two build integrations share (/v1/create/generate and the assistant's
 * confirmed build): the BUILD_AGENT switch, the metered provider, the page test, and the
 * words a user hears when the agent could not produce a passing page.
 */
import type { Env } from '../types';
import type { AiMeter } from '../data/ai-usage';
import { BUILD_FAILURE_COPY, resolveBuildGatewayModel } from '../data/agent/build-page';
import { loadWorkspaceBrief } from '../data/agent/workspace-brief';
import { isFeatureEnabled } from '../features/flags';
import { getCrewProvider } from '../crew/provider';
import { t, type Locale } from '../i18n';
import { agentSummary } from '../verify/report';
import { runVerify } from '../verify/service';
import { ENTRYPOINT } from './page-files';
import { runBuildAgent, type BuildAgentDeps, type BuildAgentResult } from './agent';

/**
 * Whether an AI page build runs as the tool-using agent. `BUILD_AGENT=off` is a kill switch
 * that beats every flag; `BUILD_AGENT=on` forces it for the whole instance; otherwise the
 * `ai.build_agent` feature flag decides for the build's workspace (default off). A build with
 * no workspace follows the global flag.
 */
export async function buildAgentEnabled(env: Env, workspaceId?: string | null): Promise<boolean> {
  const forced = (env.BUILD_AGENT ?? '').trim().toLowerCase();
  if (forced === 'off') return false;
  if (forced === 'on') return true;
  try {
    return await isFeatureEnabled(env, BUILD_AGENT_FLAG, workspaceId);
  } catch {
    return false;
  }
}

export const BUILD_AGENT_FLAG = 'ai.build_agent';

export interface PageBuildRequest {
  env: Env;
  user: { id: string; email: string | null };
  meter: AiMeter;
  locale: Locale;
  prompt: string;
  /** The page as it is now (index.html text), when changing an existing one. */
  previousHtml?: string;
  isPublic: boolean;
  /** The workspace whose brand, language and house style the page gets. Absent: none. */
  briefWorkspaceId?: string | null;
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
  // The workspace's model choice (else the instance's), as chat and crew honour it.
  const gatewayModel = await resolveBuildGatewayModel(req.env, req.meter.workspaceId);
  const provider = getCrewProvider(req.env, gatewayModel);
  if (!provider) return null;
  const brief = await loadWorkspaceBrief(req.env, req.briefWorkspaceId);
  return runBuildAgent(
    {
      env: req.env,
      provider,
      meter: { ...req.meter, kind: 'page_build' },
      locale: req.locale,
      isPublic: req.isPublic,
      brief,
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
