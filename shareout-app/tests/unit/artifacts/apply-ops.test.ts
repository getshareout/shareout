// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  applyOps, nearestLine, parseOps, replaceText, summarize, textsNeeded, type BaseFile, type EditOp,
} from '../../../src/artifacts/apply-ops';

const file = (path: string, text: string, mime = 'text/html'): BaseFile =>
  ({ path, mime, size: new TextEncoder().encode(text).length, sha256: `sha-${path}`, r2Key: `art/v1/${path}`, text });

describe('replaceText', () => {
  it('replaces exactly one match, literally', () => {
    const r = replaceText('a $1 b', '$1', '$& $$ $` $\' $<x>');
    expect(r).toMatchObject({ ok: true, content: 'a $& $$ $` $\' $<x> b', count: 1, lines: [1] });
  });

  it('refuses more than one match unless all, naming the lines', () => {
    expect(replaceText('x\ny\nx', 'x', 'z')).toEqual({ ok: false, code: 'EDIT_AMBIGUOUS', lines: [1, 3] });
    expect(replaceText('x\ny\nx', 'x', 'z', true)).toMatchObject({ ok: true, content: 'z\ny\nz', count: 2, lines: [1, 3] });
  });

  it('reports the nearest line when nothing matches', () => {
    const r = replaceText('<h1>Hello</h1>\n<p class="lead">Welcome back</p>\n', '<p class="lede">Welcome back</p>', 'x');
    expect(r).toEqual({ ok: false, code: 'EDIT_NO_MATCH', nearest: { line: 2, text: '<p class="lead">Welcome back</p>' } });
  });

  it('matches an LF old in a CRLF file and keeps CRLF', () => {
    const r = replaceText('a\r\nb\r\nc\r\n', 'a\nb', 'A\nB\nB2');
    expect(r).toMatchObject({ ok: true, content: 'A\r\nB\r\nB2\r\nc\r\n' });
  });

  it('matches a CRLF old in an LF file and keeps LF', () => {
    expect(replaceText('a\nb\nc', 'a\r\nb', 'x\r\ny')).toMatchObject({ ok: true, content: 'x\ny\nc' });
  });

  it('handles unicode beyond the BMP and a byte-order mark', () => {
    const r = replaceText('﻿café 🎉 naïve', '🎉', '🚀✨');
    expect(r).toMatchObject({ ok: true, content: '﻿café 🚀✨ naïve' });
  });

  it('nearestLine says nothing when no line is close', () => {
    expect(nearestLine('aaaa\nbbbb', 'zzzzzz')).toBeUndefined();
  });
});

describe('parseOps', () => {
  it('accepts the four ops and rejects bad shapes with the op index', () => {
    const ok = parseOps([
      { op: 'replace', path: 'a', old: 'x', new: '' },
      { op: 'write', path: 'b', content: 'AA==', encoding: 'base64' },
      { op: 'delete', path: 'c' },
      { op: 'rename', from: 'd', to: 'e' },
    ]);
    expect('ops' in ok && ok.ops).toHaveLength(4);
    expect(parseOps([])).toMatchObject({ error: { code: 'INVALID_OPS' } });
    expect(parseOps([{ op: 'replace', path: 'a', old: '', new: 'x' }])).toMatchObject({ error: { op_index: 0 } });
    expect(parseOps([{ op: 'delete', path: 'a' }, { op: 'move', path: 'b' }])).toMatchObject({ error: { op_index: 1 } });
  });
});

describe('applyOps', () => {
  const site = () => [file('index.html', '<link href="styles.css"><h1>Hi</h1>'), file('styles.css', 'h1{color:red}', 'text/css'), file('app.js', 'go()', 'text/javascript')];

  it('changes only what the ops touch; the rest stays carried', () => {
    const base = site();
    const r = applyOps(base, 'index.html', [{ op: 'replace', path: 'styles.css', old: 'red', new: 'blue' }]);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.files.get('styles.css')).toMatchObject({ content: 'h1{color:blue}', replacements: 1 });
    expect(r.files.get('index.html')!.content).toBeUndefined();
    expect(r.files.get('app.js')!.content).toBeUndefined();
    expect(summarize(base, r.files)).toEqual([{ path: 'styles.css', change: 'modified', size_before: 13, size_after: 14, replacements: 1 }]);
  });

  it('stops at the first failing op', () => {
    const r = applyOps(site(), 'index.html', [
      { op: 'replace', path: 'styles.css', old: 'red', new: 'blue' },
      { op: 'replace', path: 'index.html', old: 'missing', new: 'x' },
    ]);
    expect(r).toMatchObject({ ok: false, error: { code: 'EDIT_NO_MATCH', op_index: 1, path: 'index.html' } });
  });

  it('follows renames, moves the entrypoint and reports adds, deletes and renames', () => {
    const base = site();
    const ops: EditOp[] = [
      { op: 'rename', from: 'styles.css', to: 'css/site.css' },
      { op: 'replace', path: 'css/site.css', old: 'red', new: 'green' },
      { op: 'rename', from: 'index.html', to: 'home.html' },
      { op: 'delete', path: 'app.js' },
      { op: 'write', path: 'data.json', content: '{"a":1}' },
    ];
    expect([...textsNeeded(ops, base.map((b) => b.path))]).toEqual(['styles.css']);
    const r = applyOps(base, 'index.html', ops);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.entrypoint).toBe('home.html');
    expect(summarize(base, r.files)).toEqual([
      { path: 'app.js', change: 'deleted', size_before: 4 },
      { path: 'css/site.css', change: 'renamed', from: 'styles.css', size_before: 13, size_after: 15, replacements: 1 },
      { path: 'data.json', change: 'added', size_after: 7 },
      { path: 'home.html', change: 'renamed', from: 'index.html', size_after: 35 },
    ]);
  });

  it('refuses a missing file, a taken name, a type change, binary replace and losing the main file', () => {
    const base = [...site(), { ...file('logo.png', ''), mime: 'image/png' }];
    const fails = (ops: EditOp[]) => {
      const r = applyOps(base, 'index.html', ops);
      return r.ok ? null : r.error.code;
    };
    expect(fails([{ op: 'delete', path: 'nope.css' }])).toBe('FILE_NOT_FOUND');
    expect(fails([{ op: 'rename', from: 'styles.css', to: 'app.js' }])).toBe('FILE_EXISTS');
    expect(fails([{ op: 'rename', from: 'styles.css', to: 'styles.txt' }])).toBe('RENAME_CHANGES_TYPE');
    expect(fails([{ op: 'replace', path: 'logo.png', old: 'a', new: 'b' }])).toBe('NOT_TEXT');
    expect(fails([{ op: 'write', path: 'logo.png', content: 'not base64!' , encoding: 'base64' }])).toBe('INVALID_OPS');
    expect(fails([{ op: 'write', path: 'pic.png', content: 'raw' }])).toBe('NOT_TEXT');
    expect(fails([{ op: 'delete', path: 'index.html' }])).toBe('ENTRYPOINT_MISSING');
    expect(fails([{ op: 'delete', path: 'index.html' }, { op: 'write', path: 'index.html', content: '<p>new</p>' }])).toBeNull();
  });

  it('counts UTF-8 bytes, not characters', () => {
    const base = [file('index.html', 'x')];
    const r = applyOps(base, 'index.html', [{ op: 'write', path: 'index.html', content: 'é🎉' }]);
    if (!r.ok) throw new Error(r.error.message);
    expect(summarize(base, r.files)[0]).toMatchObject({ change: 'modified', size_after: 6 });
  });
});
