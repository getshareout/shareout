// Source checks: patterns in a version's own files that break for viewers. These run
// with or without a browser (an instance without Browser Rendering gets only these).
import type { Env } from '../types';
import { findBlockedOpenScriptHosts, findBlockedOpenStyleHosts } from '../serve/security';
import type { VerifyIssue } from './types';

export interface SourceFile {
  path: string;
  mime: string;
  text: string;
}

// Served on every host an artifact runs on (router/shared-bundles.ts), so a
// root-relative path to them is correct everywhere.
const SHARED_PREFIXES = ['/sdk/', '/vendor/', '/lib/'];
const MAX_PER_RULE = 5;

interface Hit {
  file: string;
  index: number;
  excerpt: string;
}

function lineCol(text: string, index: number): string {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return `${line}:${index - last}`;
}

function isHtml(f: SourceFile): boolean {
  return f.mime === 'text/html' || /\.html?$/i.test(f.path);
}

function isCss(f: SourceFile): boolean {
  return f.mime === 'text/css' || /\.css$/i.test(f.path);
}

function isJs(f: SourceFile): boolean {
  return /javascript|ecmascript/.test(f.mime) || /\.m?js$/i.test(f.path);
}

/** Script regions of an HTML file (inline <script> bodies and on* handlers), as [start, end). */
function scriptRegions(html: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  const block = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let m = block.exec(html); m; m = block.exec(html)) {
    if (/\bsrc\s*=/i.test(m[1]) || /type\s*=\s*["']?(application\/(ld\+)?json|text\/(template|html|plain))/i.test(m[1])) continue;
    const start = m.index + m[0].indexOf('>') + 1;
    regions.push([start, start + m[2].length]);
  }
  const handler = /\son[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi;
  for (let m = handler.exec(html); m; m = handler.exec(html)) {
    const start = m.index + m[0].indexOf(m[1]) + 1;
    regions.push([start, start + m[2].length]);
  }
  return regions;
}

/** Matches of `re` in a file's code: all of a JS file, script regions of HTML. Skips // and * comment lines. */
function codeHits(f: SourceFile, re: RegExp): Hit[] {
  const regions = isHtml(f) ? scriptRegions(f.text) : isJs(f) ? [[0, f.text.length] as [number, number]] : [];
  const hits: Hit[] = [];
  for (const [start, end] of regions) {
    const code = f.text.slice(start, end);
    const scan = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (let m = scan.exec(code); m; m = scan.exec(code)) {
      const lineStart = code.lastIndexOf('\n', m.index) + 1;
      const lineText = code.slice(lineStart, code.indexOf('\n', m.index) === -1 ? undefined : code.indexOf('\n', m.index));
      if (/^\s*(\/\/|\*|\/\*)/.test(lineText)) continue;
      hits.push({ file: f.path, index: start + m.index, excerpt: lineText.trim().slice(0, 100) });
    }
  }
  return hits;
}

function issue(rule: string, severity: VerifyIssue['severity'], message: string, hint: string, hits: Hit[], files: Map<string, string>): VerifyIssue {
  const first = hits[0];
  const text = files.get(first.file) ?? '';
  return {
    check: 'source',
    rule,
    severity,
    message: `${message}${first.excerpt ? ` — \`${first.excerpt}\`` : ''}`,
    where: hits.slice(0, MAX_PER_RULE).map((h) => `${h.file}:${lineCol(files.get(h.file) ?? text, h.index)}`).join(', '),
    hint,
    count: hits.length,
  };
}

// Root-relative references to the artifact's own files: `/styles.css` resolves against
// the host root, not the artifact (served under /a/{slug}/ or a content host), so it 404s.
const HTML_ABS_ATTR = /<([a-z][\w-]*)\b[^>]*?\s(src|href|action|poster|srcset|data)\s*=\s*(["'])\s*(\/(?!\/)[^"']*)\3/gi;
const CSS_ABS = /(?:url\(\s*(["']?)(\/(?!\/)[^"')\s]*)\1\s*\)|@import\s+(["'])(\/(?!\/)[^"']*)\3)/gi;
const JS_ABS = /(?:\b(?:fetch|import)\s*\(\s*|\bfrom\s*)(["'`])(\/(?!\/)[^"'`]*)\1/g;

function absolutePathHits(f: SourceFile): Hit[] {
  const hits: Hit[] = [];
  const keep = (path: string) => !SHARED_PREFIXES.some((p) => path.startsWith(p)) && !path.startsWith('/v1/data');
  const push = (index: number, excerpt: string) => hits.push({ file: f.path, index, excerpt: excerpt.slice(0, 100) });
  if (isHtml(f)) {
    for (let m = HTML_ABS_ATTR.exec(f.text); m; m = HTML_ABS_ATTR.exec(f.text)) {
      if (keep(m[4])) push(m.index + m[0].lastIndexOf(m[4]), `${m[2]}="${m[4]}"`);
    }
    HTML_ABS_ATTR.lastIndex = 0;
  }
  if (isHtml(f) || isCss(f)) {
    for (let m = CSS_ABS.exec(f.text); m; m = CSS_ABS.exec(f.text)) {
      const path = m[2] ?? m[4];
      if (path && keep(path)) push(m.index, m[0]);
    }
    CSS_ABS.lastIndex = 0;
  }
  if (isHtml(f) || isJs(f)) {
    for (const h of codeHits(f, JS_ABS)) {
      const path = h.excerpt.match(/(["'`])(\/(?!\/)[^"'`]*)\1/)?.[2];
      if (path && keep(path)) hits.push(h);
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** External <script src> / stylesheet hosts a public page's CSP refuses. */
function blockedCdnHits(f: SourceFile, env: Env): Hit[] {
  if (!isHtml(f)) return [];
  const hits: Hit[] = [];
  const tag = /<(script|link)\b[^>]*>/gi;
  for (let m = tag.exec(f.text); m; m = tag.exec(f.text)) {
    const isScript = m[1].toLowerCase() === 'script';
    if (!isScript && !/\brel\s*=\s*["'][^"']*stylesheet/i.test(m[0])) continue;
    const url = m[0].match(isScript ? /\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/i : /\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1];
    if (!url) continue;
    let host: string;
    try {
      host = new URL(url).host.toLowerCase();
    } catch {
      continue;
    }
    const blocked = isScript ? findBlockedOpenScriptHosts([host], env) : findBlockedOpenStyleHosts([host], env);
    if (blocked.length) hits.push({ file: f.path, index: m.index, excerpt: host });
  }
  return hits;
}

export function sourceIssues(files: SourceFile[], opts: { env: Env; isPublic: boolean }): VerifyIssue[] {
  const texts = new Map(files.map((f) => [f.path, f.text]));
  const out: VerifyIssue[] = [];
  const collect = (hits: Hit[], make: (hits: Hit[]) => VerifyIssue) => {
    if (hits.length) out.push(make(hits));
  };

  collect(files.flatMap(absolutePathHits), (hits) => issue(
    'absolute_path', 'error',
    `${hits.length} root-relative path${hits.length === 1 ? '' : 's'} to the page's own files`,
    `Use relative paths: "styles.css" or "./app.js", not "/styles.css". The page is served under its own folder (/a/{slug}/ or a content host), so a path starting with "/" points outside it and 404s. Only /sdk/, /vendor/ and /lib/ may stay root-relative.`,
    hits, texts,
  ));
  collect(files.flatMap((f) => codeHits(f, /\b(?:localStorage|sessionStorage)\b/)), (hits) => issue(
    'browser_storage', 'warning', 'Uses localStorage/sessionStorage',
    'Viewers run the page in a sandbox where localStorage and sessionStorage throw SecurityError. Keep state in memory, or persist it with the SDK (sdk.json / sdk.table).',
    hits, texts,
  ));
  collect(files.flatMap((f) => codeHits(f, /(?<![\w$.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/)), (hits) => issue(
    'native_dialog', 'warning', 'Uses alert()/confirm()/prompt()',
    'Native dialogs block the page and break screenshots, PDFs and scheduled renders. Show an inline message or a <dialog> element instead.',
    hits, texts,
  ));
  collect(files.flatMap((f) => [
    ...codeHits(f, /\bfetch\s*\(\s*["'`][^"'`]*\/v1\/data\b/),
    ...codeHits(f, /\.open\s*\(\s*["'][A-Za-z]+["']\s*,\s*["'`][^"'`]*\/v1\/data\b/),
  ]), (hits) => issue(
    'raw_data_fetch', 'error', 'Calls the /v1/data API directly',
    'Use the SDK (sdk.json, sdk.table, sdk.connection …). A raw fetch to /v1/data has no viewer credentials and resolves against the wrong host on the content origin.',
    hits, texts,
  ));
  collect(files.flatMap((f) => codeHits(f, /\bnew\s+ShareOut\s*\(/)), (hits) => issue(
    'sdk_constructor', 'error', 'Creates the SDK with `new ShareOut()`',
    'Initialize with `const sdk = await ShareOut.create();` inside try/catch — the constructor alone never connects.',
    hits, texts,
  ));
  if (opts.isPublic) {
    collect(files.flatMap((f) => blockedCdnHits(f, opts.env)), (hits) => issue(
      'cdn_not_allowed', 'error',
      `Loads ${[...new Set(hits.map((h) => h.excerpt))].join(', ')}, which public pages may not load from`,
      'Public pages load scripts and styles only from the CDN allowlist. Load the library from this instance (/vendor/<package>@<version>/…) or an allowlisted CDN (jsDelivr, unpkg, cdnjs), or keep the page private.',
      hits, texts,
    ));
  }
  return out;
}
