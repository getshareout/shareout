// Data tab → "Sources": what the published page reads, where it comes from, how fresh it
// is, and which elements each source feeds — the same GET /v1/artifacts/{id}/sources list
// and words the shared-link viewer and the Studio show. Hover a source to outline its
// elements on the canvas; open its feeds to jump to one.
import type { EditorContext } from '../editor/context';
import { createLogger } from '../editor/logger';
import { escapeHtml } from '../utils';
import { DATA_SOURCES_COPY, type DataSourcesCopy, type DataSourcesLocale } from '../../../shared/data-sources/copy';
import { createSourceFormatter, fill, type SourceFormatter } from '../../../shared/data-sources/format';
import type { DataSource, SourcesResponse } from '../../../shared/data-sources/types';

const log = createLogger('sources');

const HOVER_ATTR = 'data-editor-hover';
const MAX_OUTLINED = 200;
let outlined: Element[] = [];

/** Forget the cached list (tests; after a publish). */
export function resetSourcesCache(): void {
  cache = null;
}

export function sourcesLocale(lang: string | undefined = typeof navigator !== 'undefined' ? navigator.language : 'en'): DataSourcesLocale {
  return (lang || '').toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** Outline the canvas elements matching `selectors` (the editor's own hover style). */
export function outlineOnCanvas(ctx: EditorContext, selectors: string[], scroll = false): number {
  for (const el of outlined) el.removeAttribute(HOVER_ATTR);
  outlined = [];
  const doc = ctx.dom.canvasFrame?.contentDocument;
  if (!doc) return 0;
  for (const sel of selectors.slice(0, 100)) {
    try {
      doc.querySelectorAll(sel).forEach((el) => {
        if (outlined.length >= MAX_OUTLINED || outlined.includes(el)) return;
        el.setAttribute(HOVER_ATTR, 'true');
        outlined.push(el);
      });
    } catch {
      // a selector this draft no longer supports
    }
  }
  if (scroll && outlined[0] && typeof outlined[0].scrollIntoView === 'function') {
    outlined[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }
  return outlined.length;
}

function feedName(f: DataSource['feeds'][number]): string {
  return f.label || (f.element_id ? `#${f.element_id}` : f.selector);
}

export function renderSourcesMarkup(data: SourcesResponse, c: DataSourcesCopy, fmt: SourceFormatter): string {
  const byKey: Record<string, DataSource> = {};
  for (const s of data.sources) byKey[s.key] = s;
  const shown = data.sources.filter((s) => s.direct);
  const head = `<div class="data-section-head"><h3 class="data-section-title">${escapeHtml(c.title)}</h3></div>`;
  if (!shown.length) return `<div class="data-section">${head}<p class="data-empty">${escapeHtml(c.empty)}</p></div>`;
  const items = shown.map((s) => {
    const meta = fmt.meta(s, byKey);
    const v = fmt.details(s.details);
    const feeds = s.feeds.length
      ? `<details class="data-src-feeds"><summary>${escapeHtml(fmt.feeds(s))}</summary><ul>${s.feeds
        .map((f) => `<li><button type="button" class="data-src-feed" data-feed-sel="${escapeHtml(f.selector)}">${escapeHtml(feedName(f))}</button></li>`)
        .join('')}</ul></details>`
      : `<span class="data-src-meta">${escapeHtml(fmt.feeds(s))}</span>`;
    const details = v ? `<details class="data-src-more"><summary>${escapeHtml(c.details)}</summary>${
      v.query ? `<pre>${escapeHtml(v.query)}</pre>` : ''}${
      v.rows.length ? `<dl>${v.rows.map(([k, val]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(val)}</dd>`).join('')}</dl>` : ''}${
      v.links.length ? `<div class="data-src-links">${v.links.map(([href, text]) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`).join('')}</div>` : ''
    }</details>` : '';
    return `
      <li class="data-src" data-src-ref="${escapeHtml(s.key)}" tabindex="0">
        <span class="data-src-name">${escapeHtml(fmt.label(s))}${s.declared ? '' : ` <span class="data-src-tag" title="${escapeHtml(c.undeclaredTitle)}">${escapeHtml(c.undeclared)}</span>`}</span>
        ${meta ? `<span class="data-src-meta">${escapeHtml(meta)}</span>` : ''}
        ${s.freshness.stale ? `<span class="data-src-stale">${escapeHtml(c.stale)}</span>` : ''}
        ${feeds}${details}
      </li>`;
  }).join('');
  const note = data.version?.number ? `<p class="data-src-note">${escapeHtml(fill(c.publishedVersion, { n: data.version.number }))}</p>` : '';
  return `<div class="data-section">${head}<ul class="data-src-list">${items}</ul>${note}</div>`;
}

// The Data tab re-renders after every store edit; the published version it describes
// doesn't change underneath it, so one read per minute is plenty.
const CACHE_MS = 60_000;
let cache: { id: string; at: number; data: SourcesResponse } | null = null;

export async function renderSourcesSection(ctx: EditorContext, host: HTMLElement): Promise<void> {
  const lang = sourcesLocale();
  const c = DATA_SOURCES_COPY[lang];
  const id = ctx.config.artifactId;
  const fresh = cache && cache.id === id && Date.now() - cache.at < CACHE_MS ? cache.data : null;
  const data = fresh ?? (await loadSources(host, id, c));
  if (!data) return;
  host.innerHTML = renderSourcesMarkup(data, c, createSourceFormatter(c, lang));
  wireSources(ctx, host, data);
}

async function loadSources(host: HTMLElement, id: string, c: DataSourcesCopy): Promise<SourcesResponse | null> {
  host.innerHTML = `<div class="data-section"><p class="data-empty">${escapeHtml(c.loading)}</p></div>`;
  try {
    const res = await fetch(`/v1/artifacts/${encodeURIComponent(id)}/sources`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    // A page that was never published has no sources to describe yet.
    if (res.status === 404) { host.innerHTML = ''; return null; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as SourcesResponse;
    cache = { id, at: Date.now(), data };
    return data;
  } catch (err) {
    log.warn('sources load failed', err);
    host.innerHTML = `<div class="data-section"><p class="data-empty">${escapeHtml(c.error)}</p></div>`;
    return null;
  }
}

function findOnCanvas(ctx: EditorContext, selector: string): Element | null {
  try {
    return ctx.dom.canvasFrame?.contentDocument?.querySelector(selector) ?? null;
  } catch {
    return null;
  }
}

function wireSources(ctx: EditorContext, host: HTMLElement, data: SourcesResponse): void {
  const selectorsOf = (ref: string | null) => data.sources.find((s) => s.key === ref)?.feeds.map((f) => f.selector) ?? [];
  host.querySelectorAll<HTMLElement>('[data-src-ref]').forEach((row) => {
    const ref = row.dataset.srcRef ?? null;
    const on = () => outlineOnCanvas(ctx, selectorsOf(ref));
    const off = () => outlineOnCanvas(ctx, []);
    row.addEventListener('mouseenter', on);
    row.addEventListener('focusin', on);
    row.addEventListener('mouseleave', off);
    row.addEventListener('focusout', (e) => { if (!row.contains(e.relatedTarget as Node | null)) off(); });
  });
  host.querySelectorAll<HTMLButtonElement>('[data-feed-sel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = findOnCanvas(ctx, btn.dataset.feedSel ?? '');
      if (!el) return;
      outlineOnCanvas(ctx, []);
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      ctx.selectElement(el);
    });
  });
}
