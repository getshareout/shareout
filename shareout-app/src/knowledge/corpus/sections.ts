// HTML page → titled sections, so a passage can be cited by its heading (often numbered,
// e.g. "3.2 Waste classification") and deep-linked by the heading's id. Pure string work
// (no AI call, no HTMLRewriter) — shared by corpus ingest and the agent's live page scan.
import { extractTextFromHtml } from '../../serve/utils';
import type { Chunk } from './chunk';

export interface Section {
  heading: string;
  /** The heading's id (or its wrapping section's), when it has one. */
  anchor: string | null;
  text: string;
}

export interface PageSections {
  title: string;
  sections: Section[];
}

const MAX_SECTION_CHARS = 1500;
const HEADING_RE = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi;
const ID_RE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function attrId(attrs: string): string | null {
  const m = ID_RE.exec(attrs);
  const id = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
  return id && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(id) ? id : null;
}

const oneLine = (html: string) => extractTextFromHtml(html).replace(/\s+/g, ' ').trim();

/** The nearest id an anchor link can target: the heading's own, else an opening tag just before it. */
function nearbyId(body: string, at: number, attrs: string): string | null {
  const own = attrId(attrs);
  if (own) return own;
  const before = body.slice(Math.max(0, at - 300), at);
  const tag = /<(section|article|div|a)\b([^>]*)>\s*$/i.exec(before);
  return tag ? attrId(tag[2]) : null;
}

export function htmlSections(html: string): PageSections {
  const clean = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(clean);
  const bodyStart = clean.search(/<body\b/i);
  const body = bodyStart >= 0 ? clean.slice(bodyStart) : clean;

  const sections: Section[] = [];
  let heading = '';
  let anchor: string | null = null;
  let from = 0;
  let firstH1 = '';
  const push = (end: number) => {
    const text = extractTextFromHtml(body.slice(from, end));
    if (text) sections.push({ heading, anchor, text });
  };
  for (const m of body.matchAll(HEADING_RE)) {
    push(m.index!);
    heading = oneLine(m[3]).slice(0, 160);
    anchor = nearbyId(body, m.index!, m[2]);
    if (!firstH1 && m[1] === '1') firstH1 = heading;
    from = m.index! + m[0].length;
  }
  push(body.length);
  const title = (titleTag ? oneLine(titleTag[1]) : '') || firstH1;
  return { title: title.slice(0, 160), sections };
}

/** Chunks for one page: each section split at MAX_SECTION_CHARS, keeping its heading + anchor. */
export function chunkSections(page: PageSections, opts: { startOrd: number; page: string | null; max: number }): Chunk[] {
  const out: Chunk[] = [];
  const prefix = opts.page && page.title ? `${page.title} › ` : '';
  for (const s of page.sections) {
    for (let i = 0; i < s.text.length && out.length < opts.max; i += MAX_SECTION_CHARS) {
      out.push({
        ord: opts.startOrd + out.length,
        locator: `${prefix}${s.heading}`.slice(0, 240) || page.title,
        // The heading rides in the text so keyword search matches it ("3. Waste classification").
        text: `${i === 0 && s.heading ? `${s.heading}\n` : ''}${s.text.slice(i, i + MAX_SECTION_CHARS)}`,
        page: opts.page,
        anchor: s.anchor,
      });
    }
  }
  return out;
}
