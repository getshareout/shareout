import { describe, expect, it } from 'vitest';
import { EVAL_SET, SET_VERSION } from '../../../../evals/page-build/set';
import { detectLanguage, scoreStatic, validateItem } from '../../../../evals/page-build/scorers';

describe('eval set', () => {
  it('has 20 to 30 items with unique ids and a version', () => {
    expect(EVAL_SET.length).toBeGreaterThanOrEqual(20);
    expect(EVAL_SET.length).toBeLessThanOrEqual(30);
    expect(new Set(EVAL_SET.map((i) => i.id)).size).toBe(EVAL_SET.length);
    expect(Number.isInteger(SET_VERSION)).toBe(true);
  });

  it('mixes English and Spanish, with enough of each', () => {
    const es = EVAL_SET.filter((i) => i.language === 'es').length;
    expect(es).toBeGreaterThanOrEqual(8);
    expect(EVAL_SET.length - es).toBeGreaterThanOrEqual(8);
  });

  it('covers every kind of request the brief names', () => {
    const tags = new Set(EVAL_SET.flatMap((i) => i.tags));
    for (const t of ['crud', 'kpi', 'dashboard', 'landing', 'long', 'edit']) expect(tags.has(t)).toBe(true);
  });

  it('has only well-formed items', () => {
    expect(EVAL_SET.flatMap(validateItem)).toEqual([]);
    for (const i of EVAL_SET) {
      expect(i.prompt.length).toBeGreaterThan(40);
      expect(Object.keys(i.expect).length).toBeGreaterThan(0);
    }
  });

  it('writes each prompt in the language the item says', () => {
    for (const i of EVAL_SET) expect(detectLanguage(i.prompt.toLowerCase()), i.id).toBe(i.language);
  });

  it('names every expected table in its prompt, so the check is deterministic', () => {
    for (const i of EVAL_SET.filter((x) => x.kind === 'build')) {
      for (const t of i.expect.tables ?? []) expect(i.prompt, `${i.id}:${t}`).toContain(`"${t}"`);
    }
  });

  it('starts edit items from seed pages that are themselves clean and hold what must be preserved', () => {
    for (const i of EVAL_SET.filter((x) => x.kind === 'edit')) {
      expect(scoreStatic(i.seed!).errors, i.id).toBe(0);
      const src = i.seed!.map((f) => f.content).join('\n');
      for (const s of i.expect.preserve ?? []) expect(src, `${i.id}:${s}`).toContain(s);
    }
  });
});
