import { describe, expect, it } from 'vitest';
import { compareResults, renderComparison } from '../../../../evals/page-build/compare';
import { aggregate, renderSummary } from '../../../../evals/page-build/report';
import { checkOrigin, parseArgs, UsageError } from '../../../../evals/page-build/args';
import type { EvalResults, RunRecord } from '../../../../evals/page-build/types';

const run = (itemId: string, passed: boolean, over: Partial<RunRecord> = {}, n = 1): RunRecord => ({
  itemId, run: n, built: true, wallMs: 10_000, steps: [], static: { errors: passed ? 0 : 1, warnings: 1, issues: passed ? [] : [{ rule: 'js_syntax', severity: 'error', message: 'x' }] },
  verify: null, checks: [{ name: 'table:a', pass: passed }], usage: null, passed, ...over,
});
const results = (runs: RunRecord[], setVersion = 1): EvalResults => ({
  schema: 1, setVersion, startedAt: '2026-10-29T10:00:00Z', finishedAt: '2026-10-29T11:00:00Z', origin: 'https://i.example', workspace: 'wsp_1',
  repeat: 1, verify: true, runs, aggregate: aggregate(runs), created: ['art_1'],
});

describe('aggregate', () => {
  it('computes pass rate, check rate, issues and wall time', () => {
    const a = aggregate([
      run('a', true, { wallMs: 10_000 }),
      run('b', false, { wallMs: 30_000, verify: { status: 'warn', errors: 0, warnings: 3, issues: [] } }),
      run('c', false, { built: false, error: 'no build', static: null, checks: [], wallMs: 20_000 }),
    ]);
    expect(a).toMatchObject({ runs: 3, built: 2, passed: 1, meanCheckRate: 0.5, meanStaticIssues: 1.5, meanVerifyIssues: 3, verified: 1 });
    expect(a.passRate).toBeCloseTo(0.3333, 3);
    expect(a.wallMs).toEqual({ mean: 20_000, p50: 20_000, max: 30_000, total: 60_000 });
    expect(a.usage).toBeNull();
  });

  it('is empty-safe', () => {
    expect(aggregate([])).toMatchObject({ runs: 0, passRate: 0, wallMs: { mean: 0, max: 0 } });
  });
});

describe('renderSummary', () => {
  it('lists failures with their reason and never prints a token', () => {
    const md = renderSummary(results([run('a', true), run('b', false, { checks: [{ name: 'table:x', pass: false }, { name: 'feature:chart', pass: false }] })]));
    expect(md).toContain('| pass rate | 50% (1/2) |');
    expect(md).toContain('| b | 1 | 1 static error(s): js_syntax; missed: table:x, feature:chart |');
    expect(md).toContain('n/a (no browser verify)');
  });
});

describe('compareResults', () => {
  const before = results([run('a', true), run('b', true), run('c', false), run('only-before', true)]);
  const after = results([run('a', true), run('b', false), run('c', true), run('only-after', true)]);

  it('finds regressions, improvements and items in one file only', () => {
    const c = compareResults(before, after);
    expect(c.regressions.map((r) => r.itemId)).toEqual(['b']);
    expect(c.regressions[0].reason).toContain('js_syntax');
    expect(c.improvements.map((r) => r.itemId)).toEqual(['c']);
    expect(c.onlyBefore).toEqual(['only-before']);
    expect(c.onlyAfter).toEqual(['only-after']);
    expect(c.passRate).toEqual({ before: 0.75, after: 0.75, delta: 0 });
  });

  it('treats a lower pass share across repeats as a regression', () => {
    const b = results([run('a', true, {}, 1), run('a', true, {}, 2)]);
    const a = results([run('a', true, {}, 1), run('a', false, {}, 2)]);
    const c = compareResults(b, a);
    expect(c.regressions[0]).toMatchObject({ itemId: 'a', before: 1, after: 0.5 });
    expect(c.passRate.delta).toBe(-0.5);
  });

  it('warns when the set versions differ and renders a readable table', () => {
    const c = compareResults(before, results(after.runs, 2));
    expect(c.setVersionMismatch).toBe(true);
    const md = renderComparison(compareResults(before, after), { before: 'a.json', after: 'b.json' });
    expect(md).toContain('## Regressions (1)');
    expect(md).toContain('- b: 100% → 0%');
    expect(renderComparison(c, { before: 'a', after: 'b' })).toContain('different set versions');
  });
});

describe('parseArgs', () => {
  const base = ['--origin', 'https://i.example/', '--workspace', 'wsp_1', '--token-env', 'MY_TOKEN'];

  it('parses a run with every option', () => {
    expect(parseArgs([...base, '--only', 'a, b', '--repeat', '2', '--out', 'x.json', '--no-verify', '--cleanup'])).toEqual({
      cmd: 'run', origin: 'https://i.example', workspace: 'wsp_1', tokenEnv: 'MY_TOKEN', only: ['a', 'b'], repeat: 2, out: 'x.json', verify: false, cleanup: true,
    });
  });

  it('defaults to one run with verify on and no cleanup', () => {
    expect(parseArgs(base)).toMatchObject({ cmd: 'run', repeat: 1, verify: true, cleanup: false, only: undefined });
  });

  it('parses compare, cleanup and list', () => {
    expect(parseArgs(['compare', 'a.json', 'b.json'])).toEqual({ cmd: 'compare', before: 'a.json', after: 'b.json' });
    expect(parseArgs(['cleanup', '--from', 'r.json', '--origin', 'https://i.example', '--token-env', 'T'])).toMatchObject({ cmd: 'cleanup', from: 'r.json' });
    expect(parseArgs(['list'])).toEqual({ cmd: 'list' });
  });

  it('rejects what it cannot trust, loudly', () => {
    expect(() => parseArgs(['--workspace', 'w', '--token-env', 'T'])).toThrow(/--origin is required/);
    expect(() => parseArgs([...base, '--repeat', '0'])).toThrow(UsageError);
    expect(() => parseArgs([...base, '--token', 'secret'])).toThrow(/Unknown flag --token/);
    expect(() => parseArgs(['compare', 'a.json'])).toThrow(/two results files/);
    expect(() => parseArgs(['--origin', 'https://x', '--workspace', 'a b', '--token-env', 'T'])).toThrow(/workspace id/);
  });

  it('allows http only for localhost', () => {
    expect(checkOrigin('http://localhost:8787')).toBe('http://localhost:8787');
    expect(() => checkOrigin('http://instance.example')).toThrow(/https/);
    expect(() => checkOrigin('nope')).toThrow(/not a URL/);
  });
});
