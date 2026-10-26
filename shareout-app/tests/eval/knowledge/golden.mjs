// Corpus + golden set for the knowledge retrieval eval: loading and validation. Plain JS
// with no Node or Workers APIs, so the eval (workerd) and `npm run eval:knowledge -- --check`
// (Node) read the fixtures the same way. Input is a map of path → text relative to the
// fixtures root (tests/fixtures/knowledge-eval):
//   corpus/<cluster>/_manifest.json   the documents of one cluster (see README.md)
//   corpus/<cluster>/<files>          their content (.md / .txt / .json files, .html pages)
//   golden/<cluster>.json             questions with their gold passages

export const LANGS = ['es', 'en', 'es-en', 'en-es'];
export const TYPES = ['lookup', 'keyword', 'paraphrase', 'numeric', 'long', 'typo', 'inflection', 'multihop'];
export const TAGS = ['perm'];
export const GENRES = [
  'report', 'campaign-results', 'procedure', 'onboarding', 'glossary', 'meeting-notes',
  'pricing', 'policy', 'catalog', 'slides', 'table', 'brief', 'reference',
];
const DOC_LANGS = ['es', 'en', 'mixed'];
const VISIBILITY = ['workspace', 'public', 'private'];
const OWNERS = ['author', 'other', 'member'];
const FILE_MIME = { md: 'text/markdown', txt: 'text/plain', json: 'application/json' };

/** How evidence is compared with passage text: NFC, lowercase, whitespace collapsed. */
export const norm = (s) => String(s).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** A passage's locator is its heading, or "Page title › heading" on a sub-page of a site. */
export const inSection = (locator, section) => {
  const l = norm(locator || '');
  const s = norm(section);
  return l === s || l.endsWith(`› ${s}`);
};

/** Mirror of src/serve/utils.ts extractTextFromHtml (kept in step by hand; the eval re-checks against real chunks). */
export function htmlText(html) {
  const t = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
    .replace(/<(br|hr)[^>]*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)));
  return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
}

/** Sections of one HTML page, split at headings like src/knowledge/corpus/sections.ts. */
function htmlPageSections(page, html) {
  const clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const at = clean.search(/<body\b/i);
  const body = at >= 0 ? clean.slice(at) : clean;
  const out = [];
  let heading = '';
  let from = 0;
  const push = (end) => {
    const text = htmlText(body.slice(from, end));
    if (text) out.push({ page, heading, text: heading ? `${heading}\n${text}` : text });
  };
  for (const m of body.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi)) {
    push(m.index);
    heading = htmlText(m[3]).replace(/\s+/g, ' ').trim();
    from = m.index + m[0].length;
  }
  push(body.length);
  return out;
}

/** Sections of markdown / plain text / JSON, split like src/knowledge/corpus/chunk.ts: a
 *  heading only opens a section when it is the first line of a blank-line-separated block. */
function markdownSections(text) {
  const out = [];
  let cur = { page: null, heading: '', text: '' };
  for (const block of text.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const para = block.split('\n').map((l) => l.trim()).join('\n').trim();
    if (!para) continue;
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(para.split('\n')[0]);
    if (h) {
      if (cur.text) out.push(cur);
      cur = { page: null, heading: h[1], text: '' };
    }
    cur.text += `${para}\n\n`;
  }
  if (cur.text) out.push(cur);
  return out;
}

const formatOf = (path) => {
  const ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] || '').toLowerCase();
  return ext === 'markdown' ? 'md' : ext;
};

/**
 * Parse every cluster under `files` (path → text, relative to the fixtures root).
 * Returns docs, questions and every problem found; the fixtures are usable only when
 * `errors` is empty. Warnings point at likely authoring slips that don't break scoring.
 */
export function loadFixtures(files) {
  const errors = [];
  const warnings = [];
  const docs = [];
  const byId = new Map();

  for (const manifestPath of Object.keys(files).filter((p) => /^corpus\/[^/]+\/_manifest\.json$/.test(p)).sort()) {
    const cluster = manifestPath.split('/')[1];
    let manifest;
    try {
      manifest = JSON.parse(files[manifestPath]);
    } catch (e) {
      errors.push(`${manifestPath}: invalid JSON (${e.message})`);
      continue;
    }
    for (const [i, d] of (manifest.docs || []).entries()) {
      const where = `${manifestPath} docs[${i}]${d?.id ? ` (${d.id})` : ''}`;
      const bad = (msg) => errors.push(`${where}: ${msg}`);
      if (!d || typeof d.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(d.id)) { bad('id must be a lowercase slug'); continue; }
      if (byId.has(d.id)) { bad('duplicate doc id'); continue; }
      if (!d.title || typeof d.title !== 'string') bad('missing title');
      if (!['file', 'page'].includes(d.kind)) bad('kind must be file or page');
      if (!DOC_LANGS.includes(d.lang)) bad(`lang must be one of ${DOC_LANGS.join(', ')}`);
      if (!GENRES.includes(d.genre)) bad(`genre must be one of ${GENRES.join(', ')}`);
      if (!VISIBILITY.includes(d.visibility)) bad(`visibility must be one of ${VISIBILITY.join(', ')}`);
      if (!OWNERS.includes(d.owner)) bad(`owner must be one of ${OWNERS.join(', ')}`);
      if (d.visibility === 'private' && d.owner === 'author') bad('a private doc is owned by "other" or "member"');
      if (d.visibility !== 'private' && d.owner !== 'author') bad('only private docs belong to "other" or "member"');

      const base = `corpus/${cluster}/`;
      const entry = `${base}${d.path}`;
      if (typeof d.path !== 'string' || !(entry in files)) { bad(`path ${d.path} not found`); continue; }
      for (const p of [d.path, ...(d.pages || [])]) if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(p)) bad(`file path "${p}": use ASCII letters, digits, . _ - / only (the title carries the display name)`);
      const fmt = formatOf(d.path);
      let doc;
      if (d.kind === 'page') {
        if (fmt !== 'html') { bad('a page is an .html file'); continue; }
        const dir = d.path.includes('/') ? d.path.slice(0, d.path.lastIndexOf('/') + 1) : '';
        const assets = [{ path: 'index.html', content: files[entry] }];
        for (const sub of d.pages || []) {
          const p = `${base}${dir}${sub}`;
          if (!(p in files) || formatOf(sub) !== 'html') { bad(`page ${sub} not found (or not .html)`); continue; }
          assets.push({ path: sub, content: files[p] });
        }
        doc = { ...d, cluster, format: d.pages?.length ? 'site' : 'page', assets, mime: 'text/html' };
        doc.sections = assets.flatMap((a) => htmlPageSections(a.path === 'index.html' ? null : a.path, a.content));
      } else {
        if (!FILE_MIME[fmt]) { bad('a file is .md, .txt or .json'); continue; }
        if (!d.title.toLowerCase().endsWith(`.${fmt}`)) bad(`a file's title is its file name, ending in .${fmt}`);
        if (fmt === 'json') {
          try { JSON.parse(files[entry]); } catch (e) { bad(`file is not valid JSON (${e.message})`); }
        }
        doc = { ...d, cluster, format: fmt, assets: [{ path: d.title, content: files[entry] }], mime: FILE_MIME[fmt] };
        doc.sections = markdownSections(files[entry]);
      }
      if (!doc.sections.length) bad('no text found');
      for (const s of doc.sections) {
        const body = s.text.length - s.heading.length;
        if (body > 1450) warnings.push(`${d.id}: section "${s.heading || '(top)'}"${s.page ? ` on ${s.page}` : ''} is ${body} chars — it will be split into several chunks`);
      }
      docs.push(doc);
      byId.set(d.id, doc);
    }
  }

  const visible = (doc) => doc.visibility !== 'private' || doc.owner === 'member';
  const questions = [];
  const seenQ = new Map();
  for (const goldPath of Object.keys(files).filter((p) => /^golden\/[^/]+\.json$/.test(p)).sort()) {
    let list;
    try {
      list = JSON.parse(files[goldPath]);
    } catch (e) {
      errors.push(`${goldPath}: invalid JSON (${e.message})`);
      continue;
    }
    if (!Array.isArray(list)) { errors.push(`${goldPath}: expected an array of questions`); continue; }
    for (const [i, q] of list.entries()) {
      const where = `${goldPath}[${i}]${q?.id ? ` (${q.id})` : ''}`;
      const bad = (msg) => errors.push(`${where}: ${msg}`);
      if (!q || typeof q.id !== 'string' || !/^[a-z]{2}-\d{3}$/.test(q.id)) { bad('id must look like "ag-001"'); continue; }
      if (seenQ.has(q.id)) { bad(`duplicate id (also in ${seenQ.get(q.id)})`); continue; }
      seenQ.set(q.id, goldPath);
      if (typeof q.q !== 'string' || !q.q.trim() || q.q.length > 500) bad('q must be 1–500 chars');
      if (!LANGS.includes(q.lang)) bad(`lang must be one of ${LANGS.join(', ')}`);
      if (!TYPES.includes(q.type)) bad(`type must be one of ${TYPES.join(', ')}`);
      for (const t of q.tags || []) if (!TAGS.includes(t)) bad(`unknown tag ${t}`);
      if (!Array.isArray(q.gold) || !q.gold.length) { bad('gold must list at least one passage'); continue; }
      if (q.type === 'multihop' ? q.gold.length < 2 : q.gold.length !== 1) bad('multihop questions need 2+ gold passages; every other type exactly 1');
      if (q.type === 'long' && q.q.trim().split(/\s+/).length < 20) bad('a long question has at least 20 words');

      const places = new Set();
      for (const [gi, g] of q.gold.entries()) {
        for (const opt of [g, ...(g.alt || [])]) {
          const doc = byId.get(opt?.doc);
          const tag = `gold[${gi}] ${opt?.doc}`;
          if (!doc) { bad(`${tag}: unknown doc`); continue; }
          if (!visible(doc)) { bad(`${tag}: gold doc is private to another user — the eval member can't see it`); continue; }
          if (typeof opt.evidence !== 'string' || opt.evidence.trim().length < (opt.scope === 'section' ? 2 : 3) || opt.evidence.length > 160) { bad(`${tag}: evidence must be 3–160 chars (2 when scoped to its section)`); continue; }
          if (typeof opt.section !== 'string') { bad(`${tag}: section must be a heading text ("" = text before the first heading)`); continue; }
          if (opt.scope !== undefined && opt.scope !== 'section') { bad(`${tag}: scope can only be "section"`); continue; }
          const sections = doc.sections.filter((s) => norm(s.heading) === norm(opt.section) && (opt.page === undefined || s.page === (opt.page || null)));
          if (!sections.length) { bad(`${tag}: no section "${opt.section}"${opt.page ? ` on page ${opt.page}` : ''}`); continue; }
          if (!sections.some((s) => norm(s.text).includes(norm(opt.evidence)))) { bad(`${tag}: evidence "${opt.evidence}" is not in section "${opt.section}"`); continue; }
          // Twice in its own doc, a passage holding the other copy would be credited too —
          // unless the option is scoped to its section (only passages located there count).
          const copies = doc.sections.reduce((n, s) => n + norm(s.text).split(norm(opt.evidence)).length - 1, 0);
          if (copies > 1 && opt.scope !== 'section') { bad(`${tag}: evidence "${opt.evidence}" appears ${copies} times in ${doc.id} — quote a span only the answer has, or add "scope": "section"`); continue; }
          places.add(`${doc.id}\u0000${norm(opt.section)}`);
        }
      }
      if (q.type === 'multihop' && places.size < q.gold.length) bad('multihop gold passages must be different sections');
      // The answer should live only where the gold says: the same evidence in another
      // visible doc means a second right answer the scorer would count as a miss.
      const goldDocs = new Set(q.gold.flatMap((g) => [g, ...(g.alt || [])].map((o) => o?.doc)));
      for (const g of q.gold) {
        if (typeof g?.evidence !== 'string') continue;
        const ev = norm(g.evidence);
        for (const doc of docs) {
          if (goldDocs.has(doc.id) || !visible(doc)) continue;
          const s = doc.sections.find((x) => norm(x.text).includes(ev));
          if (s) bad(`evidence "${g.evidence}" also appears in ${doc.id} / "${s.heading}" — add it as an alt or quote something more specific`);
        }
      }
      const key = norm(q.q);
      const dup = questions.find((x) => norm(x.q) === key);
      if (dup) bad(`same question text as ${dup.id}`);
      questions.push({ ...q, tags: q.tags || [], cluster: goldPath.slice(7, -5) });
    }
  }
  for (const doc of docs) {
    if (visible(doc) && !questions.some((q) => q.gold.some((g) => g.doc === doc.id || (g.alt || []).some((a) => a.doc === doc.id)))) {
      warnings.push(`${doc.id}: no question has this doc as gold`);
    }
  }
  return { docs, questions, errors, warnings };
}

/** Counts per slice, for `--check` and the report header. */
export function fixtureStats({ docs, questions }) {
  const count = (items, key) => items.reduce((m, x) => {
    for (const k of [].concat(key(x))) m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const byId = new Map(docs.map((d) => [d.id, d]));
  const goldDocs = (q) => [...new Set(q.gold.map((g) => byId.get(g.doc)).filter(Boolean))];
  return {
    docs: docs.length,
    privateDocs: docs.filter((d) => d.visibility === 'private' && d.owner === 'other').length,
    docsBy: { format: count(docs, (d) => d.format), lang: count(docs, (d) => d.lang), genre: count(docs, (d) => d.genre), cluster: count(docs, (d) => d.cluster) },
    questions: questions.length,
    questionsBy: {
      lang: count(questions, (q) => q.lang),
      type: count(questions, (q) => q.type),
      source: count(questions, (q) => [...new Set(goldDocs(q).map((d) => d.format))]),
      genre: count(questions, (q) => [...new Set(goldDocs(q).map((d) => d.genre))]),
      tag: count(questions, (q) => q.tags),
      cluster: count(questions, (q) => q.cluster),
    },
  };
}
