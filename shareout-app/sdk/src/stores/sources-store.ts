import type { SdkClient } from '../core/sdk-client';

/**
 * Sources — turns the artifact's `shareout/manifest` provenance into UI so viewers
 * can answer "where does this data come from?" without the artifact hand-rolling a
 * drawer. Reads the inline manifest, exposes the declared sources, and renders a
 * standard "Data sources" drawer plus per-element "where from?" badges.
 *
 * Zero-config: declare provenance on your sources (query/description/refresh/…) and
 * either tag elements with `data-shareout-source="<key>"` or add manifest `feeds`,
 * then call `so.sources.mount()` (or add `data-shareout-sources` to <body> for
 * auto-mount). Entirely client-side — no network, no permissions.
 */

export type SourceKind = 'connection' | 'json' | 'table';

export interface SourceReplication {
  build?: string;
  publish?: string;
  credentials?: string;
  notes?: string;
}

export interface SourceEntry {
  /** `connection:warehouse`, `json:revenue`, `table:rooms`. */
  ref: string;
  kind: SourceKind;
  key: string;
  label?: string;
  description?: string;
  query?: string;
  tables?: string[];
  refresh?: string;
  asOf?: string;
  replication?: SourceReplication;
}

export interface SourceFeed {
  element: string;
  source: string;
  note?: string;
}

export interface MountSourcesOptions {
  /** Drawer heading. Default "Data sources". */
  title?: string;
  /** Floating toggle button side. Default 'right'. */
  side?: 'left' | 'right';
  /** Render per-element "where from?" badges. Default true. */
  badges?: boolean;
  /** Render the floating toggle button. Default true. */
  button?: boolean;
  /** Label for the floating button. Default "Data sources". */
  buttonLabel?: string;
}

export interface SourcesController {
  open(ref?: string): void;
  close(): void;
  destroy(): void;
}

const STYLE_ID = 'so-sources-css';
const ROOT_ID = 'so-sources-root';

const CSS = `
#${ROOT_ID}{position:fixed;inset:0;pointer-events:none;z-index:2147483600;font-family:var(--so-font,inherit)}
.so-src-btn{position:fixed;bottom:18px;pointer-events:auto;display:inline-flex;align-items:center;gap:6px;
  background:var(--so-src-accent,#1E3D35);color:#fff;border:0;border-radius:999px;padding:9px 14px;font-size:13px;
  font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.so-src-btn[data-side=right]{right:18px}.so-src-btn[data-side=left]{left:18px}
.so-src-btn:hover{filter:brightness(1.07)}
.so-src-scrim{position:absolute;inset:0;background:rgba(20,25,23,.34);opacity:0;transition:opacity .18s;pointer-events:none}
#${ROOT_ID}.open .so-src-scrim{opacity:1;pointer-events:auto}
.so-src-panel{position:absolute;top:0;bottom:0;width:min(440px,92vw);background:var(--so-src-bg,#fff);
  color:var(--so-src-ink,#222);box-shadow:0 0 40px rgba(0,0,0,.22);transform:translateX(110%);
  transition:transform .2s ease;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden}
.so-src-panel[data-side=left]{left:0;transform:translateX(-110%)}
.so-src-panel[data-side=right]{right:0}
#${ROOT_ID}.open .so-src-panel{transform:translateX(0)}
.so-src-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid rgba(0,0,0,.08)}
.so-src-head h2{margin:0;font-size:16px;font-weight:700}
.so-src-x{background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:inherit;opacity:.6}
.so-src-x:hover{opacity:1}
.so-src-body{overflow:auto;padding:12px 14px 28px;flex:1}
.so-src-empty{padding:24px 8px;color:#888;font-size:14px}
.so-src-card{border:1px solid rgba(0,0,0,.1);border-radius:10px;padding:12px 14px;margin-bottom:12px;background:var(--so-src-card,#fbfaf6)}
.so-src-card.hl{outline:2px solid var(--so-src-accent,#1E3D35);outline-offset:1px}
.so-src-card h3{margin:0 0 2px;font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px}
.so-src-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:999px;
  background:var(--so-src-accent,#1E3D35);color:#fff;opacity:.85}
.so-src-tag.stale{background:#B54708;opacity:1}
.so-src-badge.stale{background:#B54708}
.so-src-desc{margin:4px 0 8px;font-size:13px;line-height:1.45;color:var(--so-src-ink,#333)}
.so-src-meta{font-size:12px;color:#666;margin:2px 0}
.so-src-meta b{color:var(--so-src-ink,#333);font-weight:600}
.so-src-q{margin:8px 0 0}
.so-src-q summary{cursor:pointer;font-size:12px;font-weight:600;color:var(--so-src-accent,#1E3D35)}
.so-src-q pre{margin:6px 0 0;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:10px 12px;overflow:auto;
  font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.so-src-repl{margin-top:8px;border-top:1px dashed rgba(0,0,0,.12);padding-top:8px}
.so-src-repl code{background:rgba(0,0,0,.06);border-radius:5px;padding:1px 5px;font-size:11.5px}
.so-src-badge{display:inline-flex;align-items:center;gap:3px;vertical-align:middle;margin-left:6px;
  background:var(--so-src-accent,#1E3D35);color:#fff;border:0;border-radius:999px;padding:1px 8px;font-size:11px;
  font-weight:600;cursor:pointer;opacity:.9}
.so-src-badge:hover{opacity:1}
`;

// Stale-data sentinel (server-side sweep, see src/data/sheets/stale-sweep.ts) uses a
// 7-day threshold against real sync timestamps. This client-side check only has the
// author-declared `as_of` string to go on (the manifest has no live connection link),
// so it's a best-effort visual echo, not the source of truth for the sweep/bell.
const STALE_DAYS = 7;
function isStaleAsOf(asOf?: string): boolean {
  if (!asOf) return false;
  const t = Date.parse(asOf);
  return !Number.isNaN(t) && Date.now() - t > STALE_DAYS * 86_400_000;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export class SourcesStore {
  // Kept for parity with other stores / future server-backed lookups.
  constructor(private sdk: SdkClient) {
    void this.sdk;
  }

  /** Parse the inline `shareout/manifest` script. Null if absent/invalid. */
  manifest(): Record<string, unknown> | null {
    if (typeof document === 'undefined') return null;
    const node = document.querySelector('script[type="shareout/manifest"]');
    if (!node?.textContent) return null;
    try {
      return JSON.parse(node.textContent) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** All declared sources, flattened across connections/json/tables, with provenance. */
  list(): SourceEntry[] {
    const m = this.manifest();
    const sources = (m?.sources ?? {}) as Record<string, unknown>;
    const out: SourceEntry[] = [];
    for (const kind of ['connection', 'json', 'table'] as const) {
      const bucket = sources[kind === 'connection' ? 'connections' : kind === 'json' ? 'json' : 'tables'] as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (!bucket) continue;
      for (const key of Object.keys(bucket)) {
        const s = bucket[key] ?? {};
        out.push({
          ref: `${kind}:${key}`,
          kind,
          key,
          label: typeof s.label === 'string' ? s.label : undefined,
          description: typeof s.description === 'string' ? s.description : undefined,
          query: typeof s.query === 'string' ? s.query : undefined,
          tables: Array.isArray(s.tables) ? (s.tables as string[]) : undefined,
          refresh: typeof s.refresh === 'string' ? s.refresh : undefined,
          asOf: typeof s.as_of === 'string' ? s.as_of : undefined,
          replication:
            s.replication && typeof s.replication === 'object'
              ? (s.replication as SourceReplication)
              : undefined,
        });
      }
    }
    return out;
  }

  /** A single source by ref (`connection:warehouse`) or bare key. */
  get(ref: string): SourceEntry | null {
    const all = this.list();
    return all.find((s) => s.ref === ref || s.key === ref) ?? null;
  }

  /** Declared element→source feed mappings. */
  feeds(): SourceFeed[] {
    const m = this.manifest();
    const feeds = m?.feeds;
    return Array.isArray(feeds) ? (feeds as SourceFeed[]) : [];
  }

  private controller: SourcesController | null = null;

  /** Render the Data sources drawer + per-element badges. Idempotent. */
  mount(opts: MountSourcesOptions = {}): SourcesController {
    if (typeof document === 'undefined') {
      const noop: SourcesController = { open() {}, close() {}, destroy() {} };
      return noop;
    }
    if (this.controller) return this.controller;

    const side = opts.side ?? 'right';
    const title = opts.title ?? 'Data sources';
    const entries = this.list();

    ensureStyles();
    document.getElementById(ROOT_ID)?.remove();

    const root = el('div');
    root.id = ROOT_ID;
    const scrim = el('div', 'so-src-scrim');
    const panel = el('div', 'so-src-panel');
    panel.dataset.side = side;

    const head = el('div', 'so-src-head');
    const h = el('h2', undefined, title);
    const x = el('button', 'so-src-x', '×');
    x.setAttribute('aria-label', 'Close');
    head.append(h, x);

    const body = el('div', 'so-src-body');
    const cardByRef = new Map<string, HTMLElement>();
    if (entries.length === 0) {
      body.append(
        el('div', 'so-src-empty', 'No data sources declared. Add provenance to the manifest sources.')
      );
    } else {
      for (const s of entries) {
        const card = renderCard(s);
        cardByRef.set(s.ref, card);
        body.append(card);
      }
    }

    panel.append(head, body);
    root.append(scrim, panel);
    document.body.append(root);

    const open = (ref?: string) => {
      root.classList.add('open');
      if (ref) {
        const card = cardByRef.get(ref) ?? cardByRef.get(this.get(ref)?.ref ?? '');
        if (card) {
          cardByRef.forEach((c) => c.classList.remove('hl'));
          card.classList.add('hl');
          card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    };
    const close = () => root.classList.remove('open');
    scrim.addEventListener('click', close);
    x.addEventListener('click', close);

    let button: HTMLButtonElement | undefined;
    if (opts.button !== false) {
      button = el('button', 'so-src-btn');
      button.dataset.side = side;
      button.innerHTML = `<span aria-hidden="true">🗃️</span><span>${opts.buttonLabel ?? title}</span>`;
      button.addEventListener('click', () => open());
      root.append(button);
    }

    const badges: HTMLElement[] = [];
    if (opts.badges !== false) badges.push(...this.attachBadges(open));

    const controller: SourcesController = {
      open,
      close,
      destroy: () => {
        badges.forEach((b) => b.remove());
        root.remove();
        this.controller = null;
      },
    };
    this.controller = controller;
    return controller;
  }

  /** Attach "where from?" badges to feed-mapped + data-shareout-source elements. */
  private attachBadges(open: (ref?: string) => void): HTMLElement[] {
    const badges: HTMLElement[] = [];
    const seen = new Set<Element>();
    const add = (target: Element, ref: string, note?: string) => {
      if (seen.has(target)) return;
      seen.add(target);
      const src = this.get(ref);
      const stale = isStaleAsOf(src?.asOf);
      const badge = el('button', stale ? 'so-src-badge stale' : 'so-src-badge');
      badge.type = 'button';
      badge.innerHTML = `<span aria-hidden="true">ⓘ</span><span>${stale ? 'stale' : 'source'}</span>`;
      badge.title = (stale ? 'Data may be stale — ' : '') + (note || src?.label || src?.description || `Source: ${ref}`);
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        open(ref);
      });
      target.appendChild(badge);
      badges.push(badge);
    };

    for (const feed of this.feeds()) {
      let node: Element | null = null;
      try {
        node = document.querySelector(feed.element);
      } catch {
        node = document.getElementById(feed.element.replace(/^#/, ''));
      }
      if (node) add(node, feed.source, feed.note);
    }
    document.querySelectorAll<HTMLElement>('[data-shareout-source]').forEach((node) => {
      const ref = node.getAttribute('data-shareout-source');
      if (ref) add(node, ref);
    });
    return badges;
  }

  open(ref?: string): void {
    (this.controller ?? this.mount()).open(ref);
  }

  close(): void {
    this.controller?.close();
  }
}

function renderCard(s: SourceEntry): HTMLElement {
  const card = el('div', 'so-src-card');
  const h = el('h3');
  h.append(document.createTextNode(s.label || s.key));
  h.append(el('span', 'so-src-tag', s.kind));
  if (isStaleAsOf(s.asOf)) h.append(el('span', 'so-src-tag stale', 'stale'));
  card.append(h);

  if (s.description) card.append(el('div', 'so-src-desc', s.description));

  const meta = (label: string, value: string) => {
    const row = el('div', 'so-src-meta');
    const b = el('b', undefined, `${label}: `);
    row.append(b, document.createTextNode(value));
    card.append(row);
  };
  if (s.tables?.length) meta('Tables', s.tables.join(', '));
  if (s.refresh) meta('Refresh', s.refresh);
  if (s.asOf) meta('As of', s.asOf);

  if (s.query) {
    const d = el('details', 'so-src-q');
    d.append(el('summary', undefined, 'View query'));
    d.append(el('pre', undefined, s.query));
    card.append(d);
  }

  const r = s.replication;
  if (r && (r.build || r.publish || r.credentials || r.notes)) {
    const box = el('div', 'so-src-repl');
    box.append(el('div', 'so-src-meta', 'Replicate'));
    const line = (label: string, value: string) => {
      const row = el('div', 'so-src-meta');
      row.append(el('b', undefined, `${label}: `));
      const code = el('code', undefined, value);
      row.append(code);
      box.append(row);
    };
    if (r.build) line('Build', r.build);
    if (r.publish) line('Publish', r.publish);
    if (r.credentials) line('Credentials', r.credentials);
    if (r.notes) box.append(el('div', 'so-src-meta', r.notes));
    card.append(box);
  }
  return card;
}

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
