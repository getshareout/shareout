// The History panel's line diff (inspector-history.ts) runs in the browser; evaluate the
// fragment on its own and check the diff + collapsed-context output.
import { describe, expect, it } from 'vitest';
import { WORKSPACE_CLIENT } from '../../../src/pages/home/render-workspace/client-script/index';
import { workspace_client_inspector_history_JS as HISTORY } from '../../../src/pages/home/render-workspace/client-script/inspector-history';
import { workspace_client_inspector_details_JS as DETAILS } from '../../../src/pages/home/render-workspace/client-script/inspector-details';

type Op = [string, string];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (k: string) => (k === 'inspector.histUnchanged' ? '{n} unchanged lines' : k);
const lib = new Function('esc', 't', `${HISTORY}; return { lineDiff, diffHtml };`)(esc, t) as {
  lineDiff: (a: string, b: string) => Op[];
  diffHtml: (ops: Op[]) => { html: string; folds: string[] };
};
const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i)).join('\n');

describe('inspector history diff', () => {
  it('is part of the workspace client and parses', () => {
    expect(WORKSPACE_CLIENT).toContain('function renderHistory(art)');
    expect(() => new Function(WORKSPACE_CLIENT)).not.toThrow();
  });

  it('marks changed, added and removed lines only', () => {
    const ops = lib.lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
    expect(ops.filter((o) => o[0] !== ' ')).toEqual([['-', 'b'], ['+', 'B'], ['+', 'e']]);
    expect(lib.lineDiff('same', 'same').every((o) => o[0] === ' ')).toBe(true);
  });

  it('collapses long unchanged runs and keeps context around a change', () => {
    const a = lines(40);
    const b = lines(40, (i) => (i === 20 ? 'changed' : `line ${i}`));
    const { html, folds } = lib.diffHtml(lib.lineDiff(a, b));
    expect(folds).toHaveLength(2);
    expect(html).toContain('17 unchanged lines');
    expect(html).toContain('16 unchanged lines');
    expect(html).toContain('line 17');
    expect(html).toContain('line 23');
    expect(html).not.toContain('line 10<');
  });

  it('escapes source', () => {
    const { html } = lib.diffHtml(lib.lineDiff('<p>a</p>', '<script>x</script>'));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('falls back to a block replace on very large inputs', () => {
    const a = lines(2500, (i) => `a${i}`);
    const b = lines(2500, (i) => `b${i}`);
    const ops = lib.lineDiff(a, b);
    expect(ops.filter((o) => o[0] === '-')).toHaveLength(2500);
    expect(ops.filter((o) => o[0] === '+')).toHaveLength(2500);
  });
});

describe('version change notes', () => {
  const tt = (k: string) => ({ 'inspector.histAi': 'AI', 'inspector.liveChange': 'Updated {d}:' } as Record<string, string>)[k] ?? k;
  const notes = new Function('esc', 't', 'tOr', 'adRelDate', `${HISTORY}; ${DETAILS}; return { histRow, liveChangeHtml };`)(
    esc, tt, (_k: string, d: string) => d, () => '2h ago',
  ) as { histRow: (v: object, prev: unknown, live: boolean, editable: boolean) => string; liveChangeHtml: (meta: object) => string };

  it('badges an AI note in History and escapes every message', () => {
    const ai = notes.histRow({ version_no: 2, message: '<b>New chart</b>', message_source: 'ai' }, null, true, false);
    expect(ai).toContain('wsx-vh__ai');
    expect(ai).toContain('&lt;b&gt;New chart&lt;/b&gt;');
    const own = notes.histRow({ version_no: 3, message: 'Mine', message_source: 'author' }, null, false, false);
    expect(own).toContain('Mine');
    expect(own).not.toContain('wsx-vh__ai');
  });

  it('shows the live change line in Details only when there is a note', () => {
    const line = notes.liveChangeHtml({ live_message: 'Added totals', live_message_source: 'ai', updated_at: '2026-01-01T00:00:00.000Z' });
    expect(line).toContain('Updated 2h ago:');
    expect(line).toContain('wsx-vh__ai');
    expect(line).toContain('Added totals');
    expect(notes.liveChangeHtml({ live_message: null })).toBe('');
  });
});
