/**
 * Edit operations on an artifact's files: the pure part of POST /v1/artifacts/{id}/edits
 * and MCP edit_artifact, also used by the in-product chat applier.
 *
 * Replacement is literal (`$&`, `$$` and friends stay as typed) and must hit exactly one
 * place unless `all` is set, so a vague `old` fails loudly instead of changing the wrong
 * spot. A file with CRLF line endings also matches an `old` written with LF (and the
 * other way round); the replacement then takes the file's line endings.
 */
import { isTextMime } from './files';
import { mimeForPath } from '../validation';

export type EditOp =
  | { op: 'replace'; path: string; old: string; new: string; all?: boolean }
  | { op: 'write'; path: string; content: string; encoding?: 'utf8' | 'base64' }
  | { op: 'delete'; path: string }
  | { op: 'rename'; from: string; to: string };

export const MAX_OPS = 100;

export interface EditError {
  code: string;
  message: string;
  op_index?: number;
  path?: string;
  /** EDIT_NO_MATCH: the line of the file closest to the first line of `old`. */
  nearest?: { line: number; text: string };
  /** EDIT_AMBIGUOUS: 1-based line of every match (first 20). */
  lines?: number[];
}

// ── literal replace ─────────────────────────────────────────────────────────

export type ReplaceResult =
  | { ok: true; content: string; count: number; lines: number[] }
  | { ok: false; code: 'EDIT_NO_MATCH'; nearest?: { line: number; text: string } }
  | { ok: false; code: 'EDIT_AMBIGUOUS'; lines: number[] };

const MAX_REPORTED_LINES = 20;

function positions(content: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = content.indexOf(needle); i !== -1; i = content.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

function lineNumbers(content: string, at: number[]): number[] {
  const lines: number[] = [];
  let line = 1;
  let from = 0;
  for (const pos of at) {
    for (let i = content.indexOf('\n', from); i !== -1 && i < pos; i = content.indexOf('\n', from)) {
      line++;
      from = i + 1;
    }
    lines.push(line);
  }
  return lines;
}

const toCrlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
const toLf = (s: string) => s.replace(/\r\n/g, '\n');

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function similarity(a: Map<string, number>, aLen: number, b: string): number {
  if (aLen < 1 || b.length < 2) return 0;
  const seen = new Map<string, number>();
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const used = seen.get(g) ?? 0;
    if (used < (a.get(g) ?? 0)) shared++;
    seen.set(g, used + 1);
  }
  return (2 * shared) / (aLen + b.length - 1);
}

/** The line of `content` most like the first non-blank line of `old`, for a failed match. */
export function nearestLine(content: string, old: string): { line: number; text: string } | undefined {
  const probe = toLf(old).split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 1000);
  if (!probe) return undefined;
  const grams = bigrams(probe);
  const lines = toLf(content).split('\n');
  let best = { score: 0, line: 0 };
  for (let i = 0; i < lines.length && i < 100_000; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    const score = text === probe ? 1 : similarity(grams, probe.length - 1, text.slice(0, 1000));
    if (score > best.score) best = { score, line: i };
    if (score === 1) break;
  }
  if (best.score < 0.3) return undefined;
  const text = lines[best.line].trim();
  return { line: best.line + 1, text: text.length > 200 ? `${text.slice(0, 200)}…` : text };
}

/** Literal search-and-replace: one match required unless `all`. */
export function replaceText(content: string, old: string, replacement: string, all = false): ReplaceResult {
  const variants: Array<[string, string]> = [[old, replacement]];
  if (content.includes('\r\n') && old.includes('\n') && !old.includes('\r\n')) variants.push([toCrlf(old), toCrlf(replacement)]);
  else if (!content.includes('\r\n') && old.includes('\r\n')) variants.push([toLf(old), toLf(replacement)]);

  for (const [needle, value] of variants) {
    const at = positions(content, needle);
    if (!at.length) continue;
    if (at.length > 1 && !all) return { ok: false, code: 'EDIT_AMBIGUOUS', lines: lineNumbers(content, at.slice(0, MAX_REPORTED_LINES)) };
    let out = '';
    let last = 0;
    for (const pos of at) {
      out += content.slice(last, pos) + value;
      last = pos + needle.length;
    }
    return { ok: true, content: out + content.slice(last), count: at.length, lines: lineNumbers(content, at.slice(0, MAX_REPORTED_LINES)) };
  }
  return { ok: false, code: 'EDIT_NO_MATCH', nearest: nearestLine(content, old) };
}

// ── op parsing ──────────────────────────────────────────────────────────────

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Shape-checks the request's `ops`; paths are checked for safety by the caller. */
export function parseOps(raw: unknown): { ops: EditOp[] } | { error: EditError } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: { code: 'INVALID_OPS', message: 'ops must be a non-empty array.' } };
  if (raw.length > MAX_OPS) return { error: { code: 'INVALID_OPS', message: `At most ${MAX_OPS} ops per call.` } };
  const ops: EditOp[] = [];
  for (const [i, o] of raw.entries()) {
    const bad = (message: string): { error: EditError } => ({ error: { code: 'INVALID_OPS', message: `ops[${i}]: ${message}`, op_index: i } });
    if (!o || typeof o !== 'object') return bad('each op must be an object.');
    const op = o as Record<string, unknown>;
    switch (op.op) {
      case 'replace':
        if (!isStr(op.path) || !isStr(op.old) || !isStr(op.new)) return bad('replace needs path, old and new (strings).');
        if (!op.old) return bad('old must not be empty.');
        if (op.all !== undefined && typeof op.all !== 'boolean') return bad('all must be a boolean.');
        ops.push({ op: 'replace', path: op.path, old: op.old, new: op.new, ...(op.all ? { all: true } : {}) });
        break;
      case 'write':
        if (!isStr(op.path) || !isStr(op.content)) return bad('write needs path and content (strings).');
        if (op.encoding !== undefined && op.encoding !== 'utf8' && op.encoding !== 'base64') return bad('encoding must be "utf8" or "base64".');
        ops.push({ op: 'write', path: op.path, content: op.content, ...(op.encoding === 'base64' ? { encoding: 'base64' as const } : {}) });
        break;
      case 'delete':
        if (!isStr(op.path)) return bad('delete needs path.');
        ops.push({ op: 'delete', path: op.path });
        break;
      case 'rename':
        if (!isStr(op.from) || !isStr(op.to)) return bad('rename needs from and to.');
        ops.push({ op: 'rename', from: op.from, to: op.to });
        break;
      default:
        return bad('op must be "replace", "write", "delete" or "rename".');
    }
  }
  return { ops };
}

/** Paths an op creates (write targets, rename targets): the ones a caller must vet. */
export function newPaths(ops: EditOp[]): string[] {
  return ops.flatMap((o) => (o.op === 'write' ? [o.path] : o.op === 'rename' ? [o.to] : []));
}

// ── applying ────────────────────────────────────────────────────────────────

/** A file of the version the edit starts from. `text` is loaded only when an op needs it. */
export interface BaseFile {
  path: string;
  mime: string;
  size: number;
  sha256: string;
  r2Key: string;
  text?: string;
}

/**
 * A file after the ops. `content` undefined: the bytes of `base`, untouched (possibly
 * under a new path). Otherwise new content, in `encoding`.
 */
export interface FileState {
  mime: string;
  base?: BaseFile;
  content?: string;
  encoding: 'utf8' | 'base64';
  replacements: number;
}

/** Base files whose text the ops read (replace targets, followed through renames). */
export function textsNeeded(ops: EditOp[], basePaths: Iterable<string>): Set<string> {
  const origin = new Map<string, string | null>([...basePaths].map((p) => [p, p]));
  const need = new Set<string>();
  for (const op of ops) {
    if (op.op === 'replace') {
      const from = origin.get(op.path);
      if (from) need.add(from);
    } else if (op.op === 'write') origin.set(op.path, null);
    else if (op.op === 'delete') origin.delete(op.path);
    else if (origin.has(op.from)) {
      origin.set(op.to, origin.get(op.from) ?? null);
      origin.delete(op.from);
    }
  }
  return need;
}

export type ApplyResult =
  | { ok: true; files: Map<string, FileState>; entrypoint: string }
  | { ok: false; error: EditError };

/** Runs every op in order on an in-memory copy; the first failure stops the batch. */
export function applyOps(base: BaseFile[], entrypoint: string, ops: EditOp[]): ApplyResult {
  const files = new Map<string, FileState>(base.map((b) => [b.path, { mime: b.mime, base: b, encoding: 'utf8', replacements: 0 }]));
  let main = entrypoint;

  for (const [i, op] of ops.entries()) {
    const fail = (code: string, message: string, path: string, extra: Partial<EditError> = {}): ApplyResult =>
      ({ ok: false, error: { code, message: `ops[${i}]: ${message}`, op_index: i, path, ...extra } });

    if (op.op === 'replace') {
      const st = files.get(op.path);
      if (!st) return fail('FILE_NOT_FOUND', `there is no file "${op.path}".`, op.path);
      if (st.encoding === 'base64' || !isTextMime(st.mime)) return fail('NOT_TEXT', `"${op.path}" is not a text file; use write with encoding "base64".`, op.path);
      const text = st.content ?? st.base?.text;
      if (text === undefined) throw new Error(`text of ${op.path} was not loaded`);
      const r = replaceText(text, op.old, op.new, op.all);
      if (!r.ok) {
        return r.code === 'EDIT_NO_MATCH'
          ? fail('EDIT_NO_MATCH', `old was not found in "${op.path}"${r.nearest ? `; the closest line is ${r.nearest.line}: ${r.nearest.text}` : ''}. Copy old exactly from the file.`, op.path, r.nearest ? { nearest: r.nearest } : {})
          : fail('EDIT_AMBIGUOUS', `old matches ${r.lines.length}${r.lines.length === MAX_REPORTED_LINES ? '+' : ''} places in "${op.path}" (lines ${r.lines.join(', ')}). Include more surrounding text so it matches once, or set all: true to change every one.`, op.path, { lines: r.lines });
      }
      files.set(op.path, { ...st, content: r.content, replacements: st.replacements + r.count });
    } else if (op.op === 'write') {
      const existing = files.get(op.path);
      const mime = existing?.mime ?? mimeForPath(op.path);
      const encoding = op.encoding ?? 'utf8';
      if (encoding === 'utf8' && !isTextMime(mime)) return fail('NOT_TEXT', `"${op.path}" is a binary file (${mime}); send its bytes with encoding "base64".`, op.path);
      if (encoding === 'base64' && !/^[A-Za-z0-9+/]*={0,2}$/.test(op.content)) return fail('INVALID_OPS', `content of "${op.path}" is not valid base64.`, op.path);
      files.set(op.path, { mime, base: existing?.base, content: op.content, encoding, replacements: 0 });
    } else if (op.op === 'delete') {
      if (!files.delete(op.path)) return fail('FILE_NOT_FOUND', `there is no file "${op.path}".`, op.path);
    } else {
      const st = files.get(op.from);
      if (!st) return fail('FILE_NOT_FOUND', `there is no file "${op.from}".`, op.from);
      if (op.to === op.from) continue;
      if (files.has(op.to)) return fail('FILE_EXISTS', `"${op.to}" already exists; delete it first or pick another name.`, op.to);
      if (mimeForPath(op.to) !== mimeForPath(op.from)) {
        return fail('RENAME_CHANGES_TYPE', `renaming "${op.from}" to "${op.to}" changes its file type; write the new file and delete the old one instead.`, op.to);
      }
      files.set(op.to, st);
      files.delete(op.from);
      if (op.from === main) main = op.to;
    }
  }

  if (!files.has(main)) {
    return { ok: false, error: { code: 'ENTRYPOINT_MISSING', message: `The ops remove the main file "${main}"; a page needs it.`, path: main } };
  }
  return { ok: true, files, entrypoint: main };
}

// ── summary ─────────────────────────────────────────────────────────────────

export interface FileChange {
  path: string;
  change: 'added' | 'modified' | 'deleted' | 'renamed';
  /** renamed (or renamed and modified): the old path. */
  from?: string;
  size_before?: number;
  size_after?: number;
  replacements?: number;
}

export function byteLength(st: FileState): number {
  if (st.content === undefined) return st.base?.size ?? 0;
  if (st.encoding === 'base64') return Math.floor((st.content.length * 3) / 4) - (st.content.match(/=*$/)?.[0].length ?? 0);
  return new TextEncoder().encode(st.content).length;
}

/** What changed between the base files and the result, sorted by path. */
export function summarize(base: BaseFile[], files: Map<string, FileState>): FileChange[] {
  const before = new Map(base.map((b) => [b.path, b]));
  const carried = new Set([...files.values()].flatMap((st) => (st.base ? [st.base] : [])));
  const out: FileChange[] = [];
  for (const [path, st] of files) {
    const from = st.base && st.base.path !== path ? st.base.path : undefined;
    const prior = st.base ?? before.get(path);
    if (st.content === undefined) {
      if (from) out.push({ path, change: 'renamed', from, size_after: byteLength(st) });
      continue;
    }
    out.push({
      path,
      change: from ? 'renamed' : prior ? 'modified' : 'added',
      ...(from ? { from } : {}),
      ...(prior ? { size_before: prior.size } : {}),
      size_after: byteLength(st),
      ...(st.replacements ? { replacements: st.replacements } : {}),
    });
  }
  for (const b of base) if (!carried.has(b) && !files.has(b.path)) out.push({ path: b.path, change: 'deleted', size_before: b.size });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
