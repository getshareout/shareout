import { describe, expect, it } from 'vitest';
import { detectLang, fold, matchPlan, queryTerms, stemmedChunk, tokens, type StemVocab } from '../../../src/knowledge/corpus/lexical';
import { stemEn, stemEs } from '../../../src/knowledge/corpus/stemmer';

const es = (w: string) => stemEs(fold(w));
const same = (stem: (w: string) => string, words: string[]) => new Set(words.map(stem)).size;

describe('stemEs', () => {
  it('gives every form of a word one stem', () => {
    expect(same(es, ['presupuesto', 'presupuestos'])).toBe(1);
    expect(same(es, ['aprobado', 'aprobada', 'aprobados', 'aprobó'])).toBe(1);
    expect(same(es, ['contratación', 'contrataciones', 'contrato', 'contratos'])).toBe(1);
    expect(same(es, ['política', 'políticas'])).toBe(1);
    expect(same(es, ['renovación', 'renovar'])).toBe(1);
    expect(es('clientes')).toBe('client');
  });

  it('reaches the same stem with or without accents', () => {
    expect(es('contratación')).toBe(es('contratacion'));
    expect(es('auditorías')).toBe(es('auditorias'));
  });

  it('keeps -io/-ia words and present-tense verbs whole (no accent-only endings)', () => {
    expect(same(es, ['servicio', 'servicios'])).toBe(1);
    expect(same(es, ['necesario', 'necesaria'])).toBe(1);
    expect(es('generan')).toBe(es('generar'));
    expect(es('requiere')).toBe(es('requieren'));
  });

  it('leaves codes and numbers alone', () => {
    expect(es('q3')).toBe('q3');
    expect(es('2026')).toBe('2026');
  });
});

describe('stemEn', () => {
  it('folds plurals and -ed/-ing', () => {
    expect(same(stemEn, ['budget', 'budgets'])).toBe(1);
    expect(same(stemEn, ['approve', 'approved', 'approving', 'approves'])).toBe(1);
    expect(same(stemEn, ['policy', 'policies'])).toBe(1);
    expect(same(stemEn, ['hire', 'hired', 'hiring'])).toBe(1);
    expect(stemEn('status')).toBe('status');
  });
});

describe('stemmedChunk', () => {
  it('drops stopwords and stems what is left', () => {
    expect(stemmedChunk('Políticas de RR.HH.', 'Los empleados tienen 15 días de vacaciones.')).toEqual({
      title: 'polit rr hh',
      text: 'emple 15 dias vacacion',
    });
  });

  it('stems an English chunk as English', () => {
    expect(detectLang(tokens('The budget was approved by the board').map(fold))).toBe('en');
    expect(detectLang(tokens('El presupuesto fue aprobado por el directorio').map(fold))).toBe('es');
    expect(stemmedChunk('Travel policy', 'Expenses are approved by the finance team.').text).toBe('expens approv financ team');
  });
});

describe('queryTerms', () => {
  it('drops Spanish and English stopwords and how people ask', () => {
    const terms = queryTerms('¿Me podrías decir cuál fue el presupuesto total que se aprobó para la campaña?');
    expect(terms.map((t) => t.words[0])).toEqual(['presupuesto', 'total', 'aprobó', 'campaña']);
    expect(queryTerms('what is the budget for the winter campaign?').map((t) => t.words[0])).toEqual(['budget', 'winter', 'campaign']);
  });

  it('merges words that share a stem and searches both languages’ stems', () => {
    expect(queryTerms('presupuesto Presupuestos')).toEqual([{ words: ['presupuesto', 'Presupuestos'], stems: ['presupuest', 'presupuesto'] }]);
  });
});

describe('matchPlan', () => {
  it('quotes every word so FTS operators are inert', () => {
    expect(matchPlan('budget NOT "Q3" OR*', null)).toEqual({
      strict: '"budget" AND "q3"',
      loose: '"budget" OR "q3"',
      plain: '"budget" OR "Q3"',
    });
    expect(matchPlan('  ¿? ', null)).toBeNull();
  });

  it('searches a stopword-only query as typed', () => {
    expect(matchPlan('¿Qué es esto?', null)).toEqual({ strict: null, loose: null, plain: '"Qué" OR "es" OR "esto"' });
  });

  it('needs two terms for a strict pass', () => {
    expect(matchPlan('contrataciones', null)).toMatchObject({ strict: null, loose: '("contrat" OR "contratacion")' });
  });

  it('keeps the words the index has, rarest first, and prefix-matches a partial word', () => {
    const vocab: StemVocab = {
      docs: () => new Map([['aprob', 5], ['inviern', 2]]),
      hasPrefix: (p) => p === 'presupu',
    };
    expect(matchPlan('presupues aprobados invierno podcast', vocab)).toEqual({
      strict: '"presupu"* AND ("inviern" OR "invierno") AND ("aprob" OR "aprobado")',
      loose: '"presupu"* OR ("inviern" OR "invierno") OR ("aprob" OR "aprobado")',
      plain: '"presupues"* OR "invierno" OR "aprobados"',
    });
    expect(matchPlan('podcast', vocab)).toBeNull();
  });
});
