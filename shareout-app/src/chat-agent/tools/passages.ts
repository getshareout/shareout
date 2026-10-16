// find_passages: "where is X covered?" → the page, sub-page and section that cover it,
// with a short excerpt and a deep link. Two sources, cheapest first:
//   1. the workspace knowledge corpus (already indexed by section) for every workspace the
//      member is internal to and has Knowledge on — one FTS(+vector) query each;
//   2. otherwise a bounded live scan: the few best-matching pages the member can open,
//      split into sections on the fly (no AI call).
// Both re-check access per page: the corpus through visibleSources, the scan through
// resolveArtifactAccessForUser — so a member never sees a passage from a page they can't open.
import type { Env } from '../../types';
import type { AccountTool, ToolContext } from './types';
import { corpusFor } from '../../knowledge/corpus/client';
import { searchCorpus } from '../../knowledge/corpus/search';
import { htmlSections } from '../../knowledge/corpus/sections';
import { isKnowledgeEnabled } from '../../knowledge/store';
import { quickSearch, normalize } from '../../search/quick-search';
import { artifactLink, livePages } from '../../artifacts/page-links';
import { listWorkspacesForUser, resolveArtifactAccessForUser, PERSONAL_SCOPE } from '../access';
import { scopedWorkspaceId, selectedWorkspace } from '../scope';
import { listArtifactsForUser } from './artifacts';

export interface Passage {
  artifact: { id: string; title: string };
  /** Sub-page path of a multi-page artifact; null = its home page. */
  page: string | null;
  page_title: string | null;
  section: string;
  excerpt: string;
  url: string | null;
}

const LIMIT = 5;
const MAX_WORKSPACES = 5;
const SCAN_ARTIFACTS = 6;
// R2 reads one live scan may make in total, across every candidate page.
const SCAN_PAGE_BUDGET = 40;
const MAX_PAGE_BYTES = 1_000_000;
const EXCERPT_CHARS = 320;

const terms = (q: string) => [...new Set(normalize(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))].slice(0, 12);

/** A short window of `text` around its first matching term. */
export function excerptAround(text: string, words: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  const norm = normalize(flat);
  const at = words.map((w) => norm.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  return `${start ? '…' : ''}${flat.slice(start, start + EXCERPT_CHARS).trim()}…`;
}

/** Workspaces whose corpus this member may search in the current chat scope. */
async function corpusWorkspaces(ctx: ToolContext): Promise<string[] | { error: string }> {
  if (ctx.selectedWorkspaceId === PERSONAL_SCOPE) return [];
  if (selectedWorkspace(ctx.selectedWorkspaceId)) {
    const ws = await scopedWorkspaceId(ctx);
    return ws ? [ws] : { error: 'You are not a member of this workspace.' };
  }
  return (await listWorkspacesForUser(ctx.env, ctx.userId)).map((w) => w.id).slice(0, MAX_WORKSPACES);
}

function splitLocator(locator: string, page: string | null): { pageTitle: string | null; section: string } {
  const i = page ? locator.indexOf(' › ') : -1;
  return i > 0 ? { pageTitle: locator.slice(0, i), section: locator.slice(i + 3) } : { pageTitle: null, section: locator };
}

async function fromCorpus(env: Env, userId: string, wsIds: string[], query: string): Promise<Passage[]> {
  const words = terms(query);
  const results = await Promise.all(wsIds.map(async (ws) => {
    if (!corpusFor(env, ws) || !(await isKnowledgeEnabled(env, ws).catch(() => false))) return [];
    return (await searchCorpus(env, ws, userId, query, { limit: LIMIT }).catch(() => ({ hits: [] }))).hits;
  }));
  return results.flat()
    .filter((h) => h.source.kind === 'page')
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT)
    .map((h) => {
      const { pageTitle, section } = splitLocator(h.locator, h.page);
      return {
        artifact: { id: h.source.id, title: h.source.title },
        page: h.page,
        page_title: pageTitle,
        section,
        excerpt: excerptAround(h.text, words),
        url: h.url,
      };
    });
}

async function readHtml(env: Env, r2Key: string): Promise<string | null> {
  const obj = await env.ARTIFACTS.get(r2Key);
  if (!obj || obj.size > MAX_PAGE_BYTES) return null;
  return obj.text();
}

/** Live scan of a few candidate pages the member can open. */
async function fromScan(ctx: ToolContext, query: string): Promise<Passage[]> {
  const { env, userId } = ctx;
  const words = terms(query);
  if (!words.length) return [];
  // Pages whose name/tags/description match first, then the most recently updated ones:
  // a procedures index rarely names every topic its sub-pages cover.
  const [ranked, recent] = await Promise.all([
    quickSearch(env, userId, { q: query, workspaceId: ctx.selectedWorkspaceId, groups: ['artifacts'], limit: SCAN_ARTIFACTS }),
    listArtifactsForUser(env, userId, { limit: SCAN_ARTIFACTS, workspaceId: ctx.selectedWorkspaceId }),
  ]);
  const candidates = new Map<string, { id: string; name: string; slug?: string }>();
  for (const a of ranked.artifacts) candidates.set(a.id, { id: a.id, name: a.title, slug: a.slug });
  for (const a of recent) if (!candidates.has(a.id)) candidates.set(a.id, { id: a.id, name: a.name, slug: a.slug });

  const scored: Array<Passage & { score: number }> = [];
  let budget = SCAN_PAGE_BUDGET;
  for (const c of [...candidates.values()].slice(0, SCAN_ARTIFACTS)) {
    if (budget <= 0) break;
    if (!c.slug || !(await resolveArtifactAccessForUser(env, c.id, userId))) continue;
    const { entrypoint, pages } = await livePages(env, c.id);
    const paths = (pages.length ? pages : [entrypoint]).filter(Boolean).slice(0, budget);
    if (!paths.length) continue;
    budget -= paths.length;
    const rows = (await env.DB.prepare(
      `SELECT s.path, s.r2_key FROM deployments d JOIN assets s ON s.version_id = d.version_id
        WHERE d.artifact_id = ? AND d.channel = 'production' AND s.mime = 'text/html' AND s.path IN (${paths.map(() => '?').join(',')})`,
    ).bind(c.id, ...paths).all<{ path: string; r2_key: string }>()).results || [];
    for (const r of rows) {
      const html = await readHtml(env, r.r2_key);
      if (!html) continue;
      const parsed = htmlSections(html);
      const sub = r.path === entrypoint ? null : r.path;
      for (const s of parsed.sections) {
        const head = normalize(s.heading);
        const body = normalize(s.text);
        const score = words.reduce((n, w) => n + (head.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0);
        if (!score) continue;
        scored.push({
          score,
          artifact: { id: c.id, title: c.name },
          page: sub,
          page_title: sub ? parsed.title || null : null,
          section: s.heading || parsed.title,
          excerpt: excerptAround(s.text, words),
          url: artifactLink(env, c.slug, { page: sub, section: s.anchor }),
        });
      }
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, LIMIT).map(({ score: _s, ...p }) => p);
}

export const findPassagesTool: AccountTool = {
  name: 'find_passages',
  description:
    'Find WHERE a topic, procedure, rule or step is covered in the pages the user can open. Returns `passages`: { artifact, page (sub-page path of a multi-page artifact, or null), page_title, section (the heading, often numbered), excerpt, url }. `url` opens that sub-page scrolled to the section. Answer with the page and section, quote the excerpt briefly, and give the `url`.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The topic in the user’s words, e.g. "waste classification".' } },
    required: ['query'],
  },
  async execute(ctx, input) {
    const query = typeof input.query === 'string' ? input.query.trim().slice(0, 300) : '';
    if (!query) return { error: 'Tell me what to look for.' };
    const wsIds = await corpusWorkspaces(ctx);
    if (!Array.isArray(wsIds)) return wsIds;
    const indexed = await fromCorpus(ctx.env, ctx.userId, wsIds, query);
    if (indexed.length) return { mode: 'indexed', passages: indexed };
    const scanned = await fromScan(ctx, query);
    return scanned.length
      ? { mode: 'scan', passages: scanned }
      : { mode: 'scan', passages: [], message: `No page section the user can open mentions “${query}”.` };
  },
};
