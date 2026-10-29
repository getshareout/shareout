import { describe, expect, it } from 'vitest';
import {
  countFormFields, declaredTables, detectLanguage, runPassed, scoreExpectations, scoreStatic, scoreVerify, validateItem, visibleText,
} from '../../../../evals/page-build/scorers';

const page = (body: string, head = '') => [{
  path: 'index.html',
  content: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`,
}];
const manifest = (tables: string[]) => `<script type="shareout/manifest">${JSON.stringify({ sources: { tables: Object.fromEntries(tables.map((t) => [t, { a: 'text' }])) } })}</script>`;

describe('scoreStatic', () => {
  it('is clean for a sound page', () => {
    const s = scoreStatic(page('<p>hi</p><script>const a = 1;</script>'));
    expect(s.errors).toBe(0);
  });

  it('counts a syntax error and an undeclared table as errors', () => {
    const s = scoreStatic(page('<script>const a = ;</script><script>shareout.table("ghost")</script>'));
    expect(s.errors).toBeGreaterThanOrEqual(2);
    expect(s.issues.map((i) => i.rule)).toEqual(expect.arrayContaining(['js_syntax', 'undeclared_table']));
  });

  it('reports a missing entrypoint', () => {
    expect(scoreStatic([{ path: 'app.js', content: '1' }]).issues[0].rule).toBe('no_entrypoint');
  });
});

describe('scoreVerify', () => {
  it('reads status and counts, dropping info lines', () => {
    const v = scoreVerify({ status: 'warn', counts: { error: 0, warning: 2 }, issues: [{ rule: 'a', severity: 'warning', message: 'm' }, { rule: 'b', severity: 'info', message: 'n' }] });
    expect(v).toMatchObject({ status: 'warn', errors: 0, warnings: 2 });
    expect(v!.issues).toHaveLength(1);
  });

  it('is null for anything that is not a verify body', () => {
    expect(scoreVerify(null)).toBeNull();
    expect(scoreVerify({ error: 'x' })).toBeNull();
    expect(scoreVerify({ status: 'great' })).toBeNull();
  });
});

describe('helpers', () => {
  it('reads declared tables and ignores a broken manifest', () => {
    expect(declaredTables(page(manifest(['a', 'b'])))).toEqual(['a', 'b']);
    expect(declaredTables(page('<script type="shareout/manifest">{nope</script>'))).toEqual([]);
    expect(declaredTables(page('<p>none</p>'))).toEqual([]);
  });

  it('counts fillable controls only', () => {
    const n = countFormFields(page('<input name=a><input type="hidden"><input type="submit"><button>x</button><select></select><textarea></textarea><input type="email">'));
    expect(n).toBe(4);
  });

  it('strips scripts and tags to the visible text', () => {
    expect(visibleText(page('<p>Hola mundo</p><script>const the = "and"</script>'))).toContain('Hola mundo');
    expect(visibleText(page('<script>var secret=1</script>'))).not.toContain('secret');
  });

  it('tells Spanish from English, and says nothing for too little text', () => {
    expect(detectLanguage('agregar un nuevo gasto para el mes de la oficina con el total de los gastos')).toBe('es');
    expect(detectLanguage('add the new expense for the month with the total of all of your expenses in this list')).toBe('en');
    expect(detectLanguage('hola')).toBeNull();
  });
});

describe('scoreExpectations', () => {
  const crud = page(
    `${manifest(['tasks'])}<form><input name=title required><input type=date name=due required><select name=s></select><textarea name=n></textarea></form>
     <script>const t = shareout.table('tasks'); t.insert({a:1}); const total = rows.reduce((a, b) => a + b, 0);</script>`,
    '<style>@media (max-width: 600px) { body { margin: 0 } }</style>',
  );

  it('passes when every expectation holds', () => {
    const checks = scoreExpectations(crud, { tables: ['tasks'], minFormFields: 4, features: ['validation', 'formula', 'persistence', 'responsive'], patterns: ['reduce'] });
    expect(checks.filter((c) => !c.pass)).toEqual([]);
    expect(checks.length).toBe(1 + 1 + 4 + 1);
  });

  it('names each thing that missed, with detail', () => {
    const checks = scoreExpectations(crud, { tables: ['tasks', 'projects'], minFormFields: 9, features: ['chart'], patterns: ['kanban'], minSections: 2, minChars: 100000 });
    const missed = checks.filter((c) => !c.pass);
    expect(missed.map((c) => c.name)).toEqual(['table:projects', 'form-fields>=9', 'feature:chart', 'pattern:kanban', 'sections>=2', 'chars>=100000']);
    expect(missed[0].detail).toContain('tasks');
    expect(missed[1].detail).toBe('found 4');
  });

  it('recognises a chart by library or by canvas', () => {
    expect(scoreExpectations(page('<canvas id=c></canvas>'), { features: ['chart'] })[0].pass).toBe(true);
    expect(scoreExpectations(page('<script src="https://cdn.example/chart.umd.js"></script>'), { features: ['chart'] })[0].pass).toBe(true);
    expect(scoreExpectations(page('<p>no chart here</p>'), { features: ['chart'] })[0].pass).toBe(false);
  });

  it('checks the language of what a viewer reads, not the code', () => {
    const es = page('<h1>Gastos del mes</h1><p>Agregar un nuevo gasto para la oficina con el total de los gastos del mes</p><script>const the_and_of = 1</script>');
    expect(scoreExpectations(es, { language: 'es' })[0].pass).toBe(true);
    expect(scoreExpectations(es, { language: 'en' })[0].pass).toBe(false);
  });

  it('checks preserved strings and counts sections', () => {
    const p = page('<section>a</section><h2>b</h2>keep me');
    const checks = scoreExpectations(p, { preserve: ['keep me', 'gone'], minSections: 2 });
    expect(checks.map((c) => c.pass)).toEqual([true, true, false]);
  });

  it('fails a pattern that does not compile instead of throwing', () => {
    expect(scoreExpectations(page('x'), { patterns: ['('] })[0].pass).toBe(false);
    expect(validateItem({ id: 'x', language: 'en', kind: 'build', tags: [], prompt: 'p', expect: { patterns: ['('] } })).toHaveLength(1);
  });
});

describe('runPassed', () => {
  const st = (errors: number) => ({ errors, warnings: 0, issues: [] });
  const vf = (status: 'pass' | 'warn' | 'fail') => ({ status, errors: 0, warnings: 0, issues: [] });
  const ok = [{ name: 'a', pass: true }];

  it('needs a built page, no static errors, no failed verify and every check', () => {
    expect(runPassed(true, st(0), vf('warn'), ok)).toBe(true);
    expect(runPassed(true, st(0), null, ok)).toBe(true);
    expect(runPassed(false, st(0), null, ok)).toBe(false);
    expect(runPassed(true, st(1), null, ok)).toBe(false);
    expect(runPassed(true, st(0), vf('fail'), ok)).toBe(false);
    expect(runPassed(true, st(0), null, [...ok, { name: 'b', pass: false }])).toBe(false);
    expect(runPassed(true, null, null, ok)).toBe(false);
  });
});
