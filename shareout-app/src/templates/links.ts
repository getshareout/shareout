/**
 * Link and id rewriting between a source workspace and an install.
 *
 * Saving turns every link to an artifact inside the template — `/a/<slug>`, the
 * namespaced `/@<workspace>/<folders>/<slug>` and the workspace subdomain form — into a
 * token naming the template item. Installing turns each token into the new artifact's
 * `/a/<slug>`. Links to pages of the source workspace that are not in the template
 * become `#`: they would only ever be a dead end (or a leak of a slug) elsewhere.
 * Multi-page links inside one artifact are relative and need nothing.
 */

export interface LinkItem {
  key: string;
  id: string;
  /** Routing slug (`artifacts.slug`). */
  slug: string;
  /** Human slug (`artifacts.display_slug`). */
  displaySlug: string;
}

export interface TokenizeContext {
  items: LinkItem[];
  workspaceId: string | null;
  workspaceSlug: string | null;
  /** Hosts that are this instance (platform, artifact origin). Absolute links elsewhere are left alone. */
  hosts: string[];
}

export interface TokenizeResult {
  text: string;
  /** `/a/<slug>` links that point at no template item — the caller decides if they are local. */
  unknownSlugs: string[];
  removedLinks: number;
  needsIds: boolean;
}

const BOUNDARY = `(?=[/?#"'\\s)<>\\]\\\\]|$)`;
const ORIGIN = `((?:https?:)?//[A-Za-z0-9.-]+(?::\\d+)?)?`;

function hostOf(origin: string): string {
  return origin.replace(/^(?:https?:)?\/\//, '').replace(/:\d+$/, '').toLowerCase();
}

export function tokenizeLinks(input: string, ctx: TokenizeContext): TokenizeResult {
  const bySlug = new Map(ctx.items.map((i) => [i.slug, i]));
  const byDisplay = new Map(ctx.items.map((i) => [i.displaySlug, i]));
  const hosts = new Set(ctx.hosts.map((h) => h.toLowerCase()));
  const sub = ctx.workspaceSlug ? [...hosts].map((h) => `${ctx.workspaceSlug}.${h}`) : [];
  for (const h of sub) hosts.add(h);
  const unknown = new Set<string>();
  let removed = 0;
  const token = (abs: boolean, key: string) => `{{so:${abs ? 'abs' : 'rel'}:${key}}}`;

  let text = input.replace(new RegExp(`${ORIGIN}/a/([a-z0-9][a-z0-9-]*)${BOUNDARY}`, 'g'), (m, origin: string | undefined, slug: string) => {
    if (origin && !hosts.has(hostOf(origin))) return m;
    const item = bySlug.get(slug);
    if (item) return token(!!origin, item.key);
    unknown.add(slug);
    return m;
  });

  const resolvePath = (abs: boolean, path: string, tail: string) => {
    const segs = path.split('/').filter(Boolean);
    const item = byDisplay.get(segs[segs.length - 1] ?? '');
    if (item) return token(abs, item.key) + tail;
    removed++;
    return '#';
  };

  if (ctx.workspaceSlug) {
    const ws = ctx.workspaceSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`${ORIGIN}/@${ws}/((?:[a-z0-9-]+/)*[a-z0-9-]+)(/?)${BOUNDARY}`, 'g'), (m, origin: string | undefined, path: string, tail: string) => {
      if (origin && !hosts.has(hostOf(origin))) return m;
      return resolvePath(!!origin, path, tail);
    });
    for (const h of sub) {
      const hre = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`(?:https?:)?//${hre}(?::\\d+)?/((?:[a-z0-9-]+/)*[a-z0-9-]+)(/?)${BOUNDARY}`, 'gi'), (_m, path: string, tail: string) => resolvePath(true, path, tail));
    }
  }

  let needsIds = false;
  for (const item of ctx.items) {
    if (text.includes(item.id)) { needsIds = true; text = text.split(item.id).join(`{{so:id:${item.key}}}`); }
  }
  if (ctx.workspaceId && text.includes(ctx.workspaceId)) text = text.split(ctx.workspaceId).join('{{so:workspace}}');

  return { text, unknownSlugs: [...unknown], removedLinks: removed, needsIds };
}

/** Replace links to the given source slugs (pages left out of the template) with `#`. */
export function dropLinks(input: string, slugs: string[], hosts: string[]): { text: string; removed: number } {
  if (!slugs.length) return { text: input, removed: 0 };
  const drop = new Set(slugs);
  const known = new Set(hosts.map((h) => h.toLowerCase()));
  let removed = 0;
  const text = input.replace(new RegExp(`${ORIGIN}/a/([a-z0-9][a-z0-9-]*)((?:/[^\\s"'<>)]*)?)${BOUNDARY}`, 'g'), (m, origin: string | undefined, slug: string) => {
    if (!drop.has(slug)) return m;
    if (origin && !known.has(hostOf(origin))) return m;
    removed++;
    return '#';
  });
  return { text, removed };
}

export interface ResolvedItem { slug: string; id: string }

export function resolveTokens(input: string, items: Record<string, ResolvedItem>, origin: string, workspaceId: string | null): string {
  if (!input.includes('{{so:')) return input;
  return input
    .replace(/\{\{so:(abs|rel):([a-z0-9]+)\}\}/g, (_m, kind: string, key: string) => {
      const it = items[key];
      if (!it) return '#';
      return `${kind === 'abs' ? origin : ''}/a/${it.slug}`;
    })
    .replace(/\{\{so:id:([a-z0-9]+)\}\}/g, (_m, key: string) => items[key]?.id ?? '')
    .replace(/\{\{so:workspace\}\}/g, workspaceId ?? '');
}
