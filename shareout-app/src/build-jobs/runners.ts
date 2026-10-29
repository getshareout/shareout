/**
 * What a build job runs, and what happens when it ends. The BuildJobs object (do.ts) loads this
 * lazily: it pulls in the builders, the publish path and the notifier.
 *
 * Each runner is the build the route used to stream inline, unchanged: the create build is
 * /v1/create/generate's own stream (streamGenerate) read to the end, the assistant build is the
 * confirmed build_artifact action. Metering, limits and failure copy are theirs.
 */
import type { Env } from '../types';
import { streamGenerate } from '../router/api/create';
import { D1ConversationStore } from '../chat-agent/store/d1-store';
import { deriveName } from '../data/agent/build-page';
import { notifyUser } from '../notify/deliver';
import { alertOps } from '../support/alert';
import { t } from '../i18n';
import { BUILD_JOB_COPY } from './copy';
import { runAssistantBuild } from './assistant';
import type { BuildEvent, BuildJobOutcome, BuildJobSpec, CreateBuildSpec, Emit } from './types';

export function runBuildJob(env: Env, spec: BuildJobSpec, emit: Emit): Promise<BuildJobOutcome> {
  return spec.kind === 'create' ? runCreateBuild(env, spec, emit) : runAssistantBuild(env, spec, emit);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Reads `data: {…}` records off an SSE body. Leaving early cancels the body, which stops the build at its next event. */
async function* sseEvents(res: Response): AsyncGenerator<BuildEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const record = buffer.slice(0, at).replace(/^data: /, '').trim();
        buffer = buffer.slice(at + 2);
        if (record) yield JSON.parse(record) as BuildEvent;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** /v1/create/generate's build, relayed event by event; the last done/error is the outcome. */
async function runCreateBuild(env: Env, spec: CreateBuildSpec, emit: Emit): Promise<BuildJobOutcome> {
  const { kind: _kind, ...request } = spec;
  const name = deriveName(spec.prompt);
  let outcome: BuildJobOutcome = { ok: false, name, error: t(spec.locale, BUILD_JOB_COPY).generic };
  for await (const ev of sseEvents(streamGenerate({ env, ...request }))) {
    emit(ev);
    if (ev.type === 'done') outcome = { ok: true, name, url: str(ev.url), slug: str(ev.slug), artifactId: str(ev.artifactId) };
    else if (ev.type === 'error') outcome = { ok: false, name, error: str(ev.error) ?? outcome.error };
  }
  return outcome;
}

export interface EndedJob {
  id: string;
  userId: string;
  spec: BuildJobSpec;
  outcome: BuildJobOutcome;
  /** A client was attached when it ended: it saw the result, so there is nothing to tell. */
  watched: boolean;
}

/**
 * After a job ends: an unwatched one notifies its user (bell / Home "Needs you"), in their
 * language; one the job itself cut short (timed out, interrupted) also lands in the assistant
 * thread it came from and pings the operator. A build's own failures already did both.
 */
export async function buildJobEnded(env: Env, job: EndedJob): Promise<void> {
  const { spec, outcome } = job;
  const cutShort = outcome.reason === 'timeout' || outcome.reason === 'interrupted';
  if (cutShort && spec.kind === 'assistant' && spec.threadId && outcome.error) {
    await new D1ConversationStore(env, spec.scopeKey, spec.userId, spec.threadId).appendMessage('assistant', outcome.error);
  }
  if (cutShort) {
    await alertOps(env, `⚠️ Page build job ${outcome.reason}`, [
      `From: ${job.userId} · via ${spec.kind === 'create' ? 'create' : 'assistant'} · job ${job.id}`,
      `Page: ${outcome.name}`,
    ]);
  }
  if (!job.watched && outcome.reason !== 'cancelled') await notifyBuildEnded(env, job);
}

async function notifyBuildEnded(env: Env, { id, userId, spec, outcome }: EndedJob): Promise<void> {
  const copy = t(spec.locale, BUILD_JOB_COPY);
  const why = outcome.error ? ` · ${outcome.error.length > 140 ? `${outcome.error.slice(0, 139)}…` : outcome.error}` : '';
  await notifyUser(env, {
    userId,
    actorIds: [],
    feed: {
      kind: 'page_build',
      subjectType: outcome.artifactId ? 'artifact' : 'build_job',
      subjectId: outcome.artifactId ?? id,
      payload: {
        job_id: id,
        ok: outcome.ok,
        artifact_id: outcome.artifactId ?? null,
        artifact_name: outcome.name,
        slug: outcome.slug ?? null,
        summary: outcome.ok ? copy.ready : `${copy.notFinished}${why}`,
      },
    },
  });
}
