/**
 * Static check of the page the agent wrote, run before anything is published: JS that
 * parses, a manifest that is JSON, relative references that resolve, every sdk.table
 * declared, plus the source rules the Verify service applies to published pages
 * (verify/source-checks). Needs no browser, so it runs on every instance.
 */
import { parse as parseJs } from 'acorn';
import type { Env } from '../types';
import { sourceIssues, type SourceFile } from '../verify/source-checks';
import { ENTRYPOINT, type PageFiles } from './page-files';

export interface CheckIssue {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  where?: string;
  hint?: string;
}

const MAX_SHOWN = 12;

const isHtml = (path: string) => /\.html?$/i.test(path);
const isJs = (path: string) => /\.m?js$/i.test(path);
const isCss = (path: string) => /\.css$/i.test(path);

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

interface Script {
  file: string;
  code: string;
  /** 1-based line in the file where `code` starts. */
  line: number;
  module: boolean;
}

/** Executable inline scripts of an HTML file (not JSON, templates or the manifest). */
function inlineScripts(path: string, html: string): Script[] {
  const out: Script[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1]?.toLowerCase();
    if (type && type !== 'module' && type !== 'text/javascript' && type !== 'application/javascript') continue;
    if (!m[2].trim()) continue;
    out.push({ file: path, code: m[2], line: lineOf(html, m.index + m[0].indexOf('>') + 1), module: type === 'module' });
  }
  return out;
}

function syntaxIssue(s: Script): CheckIssue | null {
  const tryParse = (sourceType: 'script' | 'module') => parseJs(s.code, { ecmaVersion: 'latest', sourceType });
  try {
    tryParse(s.module ? 'module' : 'script');
    return null;
  } catch (err) {
    const e = err as { message?: string; loc?: { line: number; column: number } };
    // A classic <script> that uses import/export/top-level await was meant as a module.
    if (!s.module) {
      try {
        tryParse('module');
        return {
          rule: 'js_not_module', severity: 'error',
          message: 'Script uses import/export or top-level await but is not type="module"',
          where: `${s.file}:${s.line}`,
          hint: 'Add type="module" to the <script> tag, or wrap the code in an async function.',
        };
      } catch {
        // Genuinely broken: report the classic-script error below.
      }
    }
    const line = s.line + (e.loc ? e.loc.line - 1 : 0);
    return {
      rule: 'js_syntax', severity: 'error',
      message: `JavaScript syntax error: ${(e.message ?? 'parse failed').replace(/\s*\(\d+:\d+\)$/, '')}`,
      where: `${s.file}:${line}${e.loc ? `:${e.loc.column + 1}` : ''}`,
      hint: 'The whole script stops at a syntax error, so every button on the page is dead. Fix that line (edit_file) and check again.',
    };
  }
}

const IMPORT_FROM = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"']+)\1/g;

/** .js files that run as modules: .mjs, <script type="module" src>, and what those import (relative). */
function moduleFiles(files: PageFiles): Set<string> {
  const mods = new Set(files.paths().filter((p) => /\.mjs$/i.test(p)));
  for (const f of files.entries().filter((e) => isHtml(e.path))) {
    const tag = /<script\b([^>]*)>/gi;
    for (let m = tag.exec(f.text); m; m = tag.exec(f.text)) {
      const src = /\btype\s*=\s*["']?module/i.test(m[1]) ? m[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] : undefined;
      if (src && !EXTERNAL.test(src)) mods.add(resolve(f.path, src));
    }
  }
  for (const f of files.entries().filter((e) => isHtml(e.path))) {
    for (const sc of inlineScripts(f.path, f.text).filter((x) => x.module)) {
      for (let m = IMPORT_FROM.exec(sc.code); m; m = IMPORT_FROM.exec(sc.code)) mods.add(resolve(f.path, m[2]));
      IMPORT_FROM.lastIndex = 0;
    }
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const f of files.entries().filter((e) => isJs(e.path) && mods.has(e.path))) {
      for (let m = IMPORT_FROM.exec(f.text); m; m = IMPORT_FROM.exec(f.text)) {
        const target = resolve(f.path, m[2]);
        if (!mods.has(target)) { mods.add(target); grew = true; }
      }
      IMPORT_FROM.lastIndex = 0;
    }
  }
  return mods;
}

const MANIFEST_RE = /<script\b[^>]*\btype\s*=\s*["']?shareout\/manifest["']?[^>]*>([\s\S]*?)<\/script\s*>/i;

/** Declared table names, or an issue when the manifest is present but not JSON. */
function manifestTables(path: string, html: string): { tables: Set<string> | null; issue?: CheckIssue } {
  const m = MANIFEST_RE.exec(html);
  if (!m) return { tables: null };
  try {
    const parsed = JSON.parse(m[1]) as { sources?: { tables?: Record<string, unknown> } };
    return { tables: new Set(Object.keys(parsed?.sources?.tables ?? {})) };
  } catch (err) {
    return {
      tables: null,
      issue: {
        rule: 'manifest_json', severity: 'error',
        message: `The manifest is not valid JSON: ${(err as Error).message}`,
        where: `${path}:${lineOf(html, m.index)}`,
        hint: 'Fix the <script type="shareout/manifest"> block: double quotes, no trailing commas, no comments.',
      },
    };
  }
}

const TABLE_CALL = /\.\s*table\s*\(\s*(["'`])([^"'`]+)\1/g;

function tableIssues(files: PageFiles, scripts: Script[], declared: Set<string> | null): CheckIssue[] {
  const used = new Map<string, string>();
  const sources = [...scripts.map((s) => ({ file: s.file, code: s.code })), ...files.entries().filter((f) => isJs(f.path)).map((f) => ({ file: f.path, code: f.text }))];
  for (const s of sources) {
    for (let m = TABLE_CALL.exec(s.code); m; m = TABLE_CALL.exec(s.code)) if (!used.has(m[2])) used.set(m[2], s.file);
    TABLE_CALL.lastIndex = 0;
  }
  const missing = [...used].filter(([name]) => !declared?.has(name));
  if (!missing.length) return [];
  return [{
    rule: 'undeclared_table', severity: 'error',
    message: `sdk.table() is used for ${missing.map(([n]) => `"${n}"`).join(', ')} but the manifest does not declare ${missing.length === 1 ? 'it' : 'them'}`,
    where: missing.map(([, f]) => f).join(', '),
    hint: 'Declare every table under sources.tables in the <script type="shareout/manifest"> block of index.html, with its schema (name + type per column).',
  }];
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/|#|\{\{|\$\{)/i;

function resolve(from: string, ref: string): string {
  const clean = ref.split('#')[0].split('?')[0];
  const parts = from.split('/').slice(0, -1);
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return decodeURIComponent(parts.join('/'));
}

function refIssues(files: PageFiles): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const f of files.entries()) {
    const refs: Array<{ tag: string; ref: string; index: number }> = [];
    if (isHtml(f.path)) {
      const tagRe = /<([a-z][\w-]*)\b([^>]*)>/gi;
      for (let m = tagRe.exec(f.text); m; m = tagRe.exec(f.text)) {
        const tag = m[1].toLowerCase();
        if (tag === 'a') continue;
        const attr = m[2].match(/\s(?:src|href|poster)\s*=\s*(["'])(.*?)\1/i);
        if (attr) refs.push({ tag, ref: attr[2].trim(), index: m.index });
      }
    }
    if (isHtml(f.path) || isCss(f.path)) {
      const urlRe = /url\(\s*(["']?)([^"')\s]+)\1\s*\)|@import\s+(["'])([^"']+)\3/gi;
      for (let m = urlRe.exec(f.text); m; m = urlRe.exec(f.text)) refs.push({ tag: 'css', ref: (m[2] ?? m[4]).trim(), index: m.index });
    }
    for (const r of refs) {
      if (!r.ref || EXTERNAL.test(r.ref)) continue;
      const target = resolve(f.path, r.ref);
      if (!target || files.has(target)) continue;
      out.push({
        rule: 'missing_file', severity: 'error',
        message: `${f.path} refers to "${r.ref}", which is not one of the page's files`,
        where: `${f.path}:${lineOf(f.text, r.index)}`,
        hint: `Write ${target} (write_file) or fix the reference. Files so far: ${files.paths().join(', ') || 'none'}.`,
      });
    }
  }
  return out;
}

/**
 * Everything wrong with the page as it stands; errors block publishing, warnings do not.
 * `entrypoint`: the page's main file when it is not index.html (an existing page being edited).
 */
export function checkPage(files: PageFiles, opts: { env: Env; isPublic: boolean; entrypoint?: string }): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const entry = opts.entrypoint ?? ENTRYPOINT;
  const main = files.text(entry);
  if (main === undefined) {
    return [{ rule: 'no_entrypoint', severity: 'error', message: `There is no ${entry}`, hint: `Write ${entry} first: it is the page people open.` }];
  }
  if (!/<html[\s>]/i.test(main) || !/<body[\s>]/i.test(main)) {
    issues.push({ rule: 'html_shell', severity: 'error', message: `${entry} is missing <html> or <body>`, hint: 'Start with <!DOCTYPE html> and include <html>, <head> and <body>.' });
  }

  const scripts = files.entries().filter((f) => isHtml(f.path)).flatMap((f) => inlineScripts(f.path, f.text));
  for (const s of scripts) {
    const i = syntaxIssue(s);
    if (i) issues.push(i);
  }
  const modules = moduleFiles(files);
  for (const f of files.entries().filter((e) => isJs(e.path))) {
    const i = syntaxIssue({ file: f.path, code: f.text, line: 1, module: modules.has(f.path) });
    if (i) issues.push(i);
  }

  const manifest = manifestTables(entry, main);
  if (manifest.issue) issues.push(manifest.issue);
  else issues.push(...tableIssues(files, scripts, manifest.tables));

  issues.push(...refIssues(files));

  const sources: SourceFile[] = files.entries().map((f) => ({ path: f.path, mime: f.mime, text: f.text }));
  for (const v of sourceIssues(sources, opts)) {
    if (v.severity === 'info') continue;
    issues.push({ rule: v.rule, severity: v.severity, message: v.message, where: v.where, hint: v.hint });
  }
  return issues;
}

export const errorsOf = (issues: CheckIssue[]) => issues.filter((i) => i.severity === 'error');

/** The issue list as the model reads it: short, numbered, errors first, with where and how to fix. */
export function formatIssues(issues: CheckIssue[]): string {
  const sorted = [...errorsOf(issues), ...issues.filter((i) => i.severity !== 'error')];
  const lines = sorted.slice(0, MAX_SHOWN).map((i, n) =>
    `${n + 1}. [${i.severity}] ${i.message}${i.where ? ` (${i.where})` : ''}${i.hint ? `\n   fix: ${i.hint}` : ''}`);
  if (sorted.length > MAX_SHOWN) lines.push(`(${sorted.length - MAX_SHOWN} more)`);
  return lines.join('\n');
}
