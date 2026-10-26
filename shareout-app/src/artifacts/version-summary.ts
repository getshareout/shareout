/**
 * Version messages: the publisher's own `message`, or — when a published version has
 * none — a short generated "what changed" line, written in the background from a
 * compact diff of the entrypoint against the previous version. Never blocks a publish;
 * every failure leaves the version without a message.
 */
import type { Env } from '../types';
import { chatComplete, getAIProvider } from '../data/agent/anthropic';
import { isFeatureEnabled } from '../features/flags';
import { localeForContent, type Locale } from '../i18n';
import { isTextMime } from './files';

export const VERSION_MESSAGE_MAX = 500;
export const VERSION_SUMMARY_FEATURE = 'ai.version_summaries';
export type MessageSource = 'author' | 'ai';

const DIFF_MAX_CHARS = 6_000;
const LINE_MAX_CHARS = 200;
const SUMMARY_MAX_CHARS = 160;

/** A publisher-supplied message, trimmed and capped; null when absent or blank. */
export function normalizeVersionMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim();
  return m ? m.slice(0, VERSION_MESSAGE_MAX) : null;
}

/**
 * Compact diff of two texts for the prompt: shared head and tail trimmed, then the
 * lines only one side has, as `-`/`+`. Order inside the changed middle is not kept —
 * enough to say what changed, linear in size, and capped.
 */
export function compactDiff(before: string, after: string, maxChars = DIFF_MAX_CHARS): string {
  const clean = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const a = clean(before), b = clean(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let ea = a.length, eb = b.length;
  while (ea > head && eb > head && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const count = new Map<string, number>();
  for (let i = head; i < eb; i++) count.set(b[i], (count.get(b[i]) ?? 0) + 1);
  const out: string[] = [];
  for (let i = head; i < ea; i++) {
    const n = count.get(a[i]) ?? 0;
    if (n > 0) count.set(a[i], n - 1); else out.push('- ' + a[i].slice(0, LINE_MAX_CHARS));
  }
  for (let i = head; i < eb; i++) {
    const n = count.get(b[i]) ?? 0;
    if (n > 0) { out.push('+ ' + b[i].slice(0, LINE_MAX_CHARS)); count.set(b[i], n - 1); }
  }
  let text = '';
  for (const line of out) {
    if (text.length + line.length + 1 > maxChars) return text + '… (diff truncated)';
    text += line + '\n';
  }
  return text;
}

function systemPrompt(locale: Locale): string {
  return [
    'You write the one-line change note for a new version of a published web page.',
    'You get a diff of its source: lines starting with "-" were removed, "+" were added.',
    `Reply with ONE short sentence (at most ${SUMMARY_MAX_CHARS} characters) saying what a viewer would notice changed:`,
    'content, sections, data, layout or behaviour. Plain words, no code, no HTML tags, no quotes, no trailing period.',
    locale === 'es' ? 'Write it in Spanish (Argentina), plain words.' : 'Write it in English.',
  ].join('\n');
}

function cleanSummary(out: string): string | null {
  const line = out.replace(/<[^>]*>/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const s = line.replace(/^["'`]+|["'`]+$/g, '').replace(/\.$/, '').trim();
  return s ? s.slice(0, SUMMARY_MAX_CHARS) : null;
}

interface VersionRow {
  id: string;
  artifact_id: string;
  version_no: number;
  entrypoint: string;
  message: string | null;
  source: string | null;
  workspace_id: string | null;
  owner_id: string | null;
}

async function entrypointText(env: Env, versionId: string, entrypoint: string): Promise<string | null> {
  const asset = await env.DB.prepare('SELECT r2_key, mime FROM assets WHERE version_id = ? AND path = ?')
    .bind(versionId, entrypoint).first<{ r2_key: string; mime: string }>();
  if (!asset || !isTextMime(asset.mime)) return null;
  const obj = await env.ARTIFACTS.get(asset.r2_key);
  return obj ? obj.text() : null;
}

/**
 * Generate and store an AI change note for one version, if it has no message yet.
 * No-op when AI is not configured, the workspace turned the feature off, the version
 * is the first one or a restore, or nothing textual changed.
 */
export async function summarizeVersion(env: Env, versionId: string): Promise<void> {
  if (!getAIProvider(env)) return;
  const v = await env.DB.prepare(`
    SELECT v.id, v.artifact_id, v.version_no, v.entrypoint, v.message, v.source, a.workspace_id, a.owner_id
      FROM versions v JOIN artifacts a ON a.id = v.artifact_id
     WHERE v.id = ?
  `).bind(versionId).first<VersionRow>();
  if (!v || v.message || v.source === 'restore') return;
  if (!(await isFeatureEnabled(env, VERSION_SUMMARY_FEATURE, v.workspace_id))) return;

  const prev = await env.DB.prepare(
    'SELECT id, entrypoint FROM versions WHERE artifact_id = ? AND version_no < ? ORDER BY version_no DESC LIMIT 1'
  ).bind(v.artifact_id, v.version_no).first<{ id: string; entrypoint: string }>();
  if (!prev) return;

  const [before, after] = await Promise.all([
    entrypointText(env, prev.id, prev.entrypoint),
    entrypointText(env, v.id, v.entrypoint),
  ]);
  if (before === null || after === null) return;
  const diff = compactDiff(before, after);
  if (!diff.trim()) return;

  const locale = await localeForContent(env, v.workspace_id, v.owner_id).catch((): Locale => 'en');
  const out = await chatComplete(env, { workspaceId: v.workspace_id, userId: v.owner_id, kind: 'version_summary', source: v.artifact_id }, [{ role: 'user', content: diff }], systemPrompt(locale), 80);

  const summary = cleanSummary(out);
  if (!summary) return;
  await env.DB.prepare(
    "UPDATE versions SET message = ?, message_source = 'ai' WHERE id = ? AND message IS NULL"
  ).bind(summary, v.id).run();
}

/** Queue {@link summarizeVersion} off the response when there is no author message. */
export function scheduleVersionSummary(
  env: Env,
  waitUntil: ((p: Promise<unknown>) => void) | undefined,
  versionId: string,
  authorMessage: string | null,
): void {
  if (authorMessage || !waitUntil) return;
  waitUntil(summarizeVersion(env, versionId).catch(() => {}));
}
