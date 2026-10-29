/** The assistant's confirmed page build, shared by the inline confirm path and the build job. */
import type { Env } from '../types';
import { executeBuildArtifact } from '../chat-agent/actions';
import { D1ConversationStore } from '../chat-agent/store/d1-store';
import type { AssistantBuildSpec, BuildJobOutcome, Emit } from './types';

/**
 * The assistant's confirmed build: progress as `build_step`, the result appended to the thread it
 * was asked in, then `build_done` + `done`. Also the inline path when BUILD_JOBS is not bound.
 */
export async function runAssistantBuild(env: Env, spec: AssistantBuildSpec, emit: Emit): Promise<BuildJobOutcome> {
  const r = await executeBuildArtifact(env, spec.userId, spec.action, (label) => emit({ type: 'build_step', label }), spec.locale);
  if (spec.threadId) {
    await new D1ConversationStore(env, spec.scopeKey, spec.userId, spec.threadId).appendMessage('assistant', r.url ? `${r.text}\n${r.url}` : r.text);
  }
  emit({ type: 'build_done', ok: r.ok, text: r.text, url: r.url, slug: r.slug, artifactId: r.artifactId, name: r.name });
  emit({ type: 'done' });
  return r.ok
    ? { ok: true, name: r.name, url: r.url, slug: r.slug, artifactId: r.artifactId }
    : { ok: false, name: r.name, error: r.text };
}
