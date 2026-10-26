// Text side of the corpus keyword search (store-do.ts): word splitting, stopwords, the
// stemmed shadow of each chunk, and the FTS5 MATCH expressions for a query. Pure
// functions, so the rules can be tested without a Durable Object.
import { stemEn, stemEs } from './stemmer';

/** Bump when stemming or stopwords change: every store rebuilds its stemmed index. */
export const STEM_VERSION = 1;

/** Words a query may contribute, after stopwords; a long question keeps its rarest ones. */
const MAX_TERMS = 12;
/** Distinct words read from a query (two stems each are looked up, one bound parameter apiece). */
const MAX_QUERY_TERMS = 24;
/** A word the index doesn't have matches as a prefix (a partial word) from this length. */
const MIN_PREFIX = 4;

const WORD = /[\p{L}\p{N}]+/gu;

/** Words as FTS5's unicode61 tokenizer sees them: letters and digits, everything else splits. */
export const tokens = (s: string): string[] => s.normalize('NFC').match(WORD) ?? [];

/** Lowercase, accents and other marks removed (the plain index's remove_diacritics). */
export const fold = (word: string) => word.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

const words = (s: string) => new Set(s.split(/\s+/));

const ES = words(
  'a al algo alguien algun alguna algunas alguno algunos ante antes aquel aquella aquellas aquello aquellos aqui asi ' +
  'aun aunque bien cada como con contra cual cuales cualquier cuando cuanta cuantas cuanto cuantos cuya cuyo de del ' +
  'desde despues donde durante e el ella ellas ello ellos en entonces entre era eran eres es esa esas ese eso esos esta ' +
  'estaba estaban estamos estan estar estas este esto estos estoy fue fueron fui ha haber habia habian hacia han has ' +
  'hasta hay he la las le les lo los mas me mediante mi mia mias mio mios mis misma mismas mismo mismos mucha muchas ' +
  'mucho muchos muy nada ni no nos nosotras nosotros nuestra nuestras nuestro nuestros o os otra otras otro otros para ' +
  'pero poco pocos por porque pues puede pueden que quien quienes se segun ser si sido siendo sin sino sobre sois somos ' +
  'son soy su sus suya suyas suyo suyos tal tambien tampoco tan tanto te tenemos tener tengo tenia tiene tienen toda ' +
  'todas todo todos tras tu tus u un una unas uno unos usted ustedes vosotras vosotros vuestra vuestro y ya yo',
);
const EN = words(
  'a about above after again against all also am an and any are as at be because been before being below between both ' +
  'but by can could did do does doing down during each few for from further had has have having he her here hers ' +
  'herself him himself his how i if in into is it its itself just may me might more most must my myself no nor not now ' +
  'of off on only or other our ours ourselves out over own same shall she should so some such than that the their ' +
  'theirs them themselves then there these they this those through to too under until up us very was we were what ' +
  'when where which while who whom whose why will with would you your yours yourself yourselves',
);
/** Function words of either language: never indexed in the stemmed column, never searched. */
const STOPWORDS = new Set([...ES, ...EN]);
/** How people ask, not what they ask about: dropped from queries only. */
const ASKING = words(
  'necesito necesitamos quiero queremos quisiera queria podrias podria puedes podes podrian dime decime digame decir ' +
  'contame cuentame saber sabes busco busca buscame buscar buscando encuentra encontrar encontrame mostrar muestrame ' +
  'mostrame explica explicame explicar dame favor hola gracias hace hacer please tell show find need want know give ' +
  'looking',
);
const ES_ONLY = new Set([...ES].filter((w) => !EN.has(w)));
const EN_ONLY = new Set([...EN].filter((w) => !ES.has(w)));

const searchable = (w: string) => !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w));

/** English when its function words outnumber Spanish ones; Spanish otherwise (the default). */
export function detectLang(folded: string[]): 'es' | 'en' {
  let es = 0;
  let en = 0;
  for (const w of folded) {
    if (ES_ONLY.has(w)) es++;
    else if (EN_ONLY.has(w)) en++;
  }
  return en > es ? 'en' : 'es';
}

/** A chunk's stemmed shadow: its words minus stopwords, each reduced to a stem. */
export function stemmedChunk(title: string, text: string): { title: string; text: string } {
  const t = tokens(title).map(fold);
  const x = tokens(text).map(fold);
  const stem = detectLang(x.length ? x : t) === 'en' ? stemEn : stemEs;
  const shadow = (list: string[]) => list.filter(searchable).map(stem).join(' ');
  return { title: shadow(t), text: shadow(x) };
}

export interface QueryTerm {
  /** The words as typed, for the plain index (which folds case and accents itself). */
  words: string[];
  /** Stems for the stemmed index: Spanish and English, since a query is too short to tell. */
  stems: string[];
}

/** A query's searchable words, merged when they share a stem (presupuesto/presupuestos). */
export function queryTerms(q: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  for (const word of tokens(q)) {
    if (terms.length >= MAX_QUERY_TERMS) break;
    const f = fold(word);
    if (!searchable(f) || ASKING.has(f)) continue;
    const stems = [...new Set([stemEs(f), stemEn(f)])];
    const same = terms.find((t) => t.stems.some((s) => stems.includes(s)));
    if (!same) {
      terms.push({ words: [word], stems });
      continue;
    }
    if (!same.words.some((w) => fold(w) === f)) same.words.push(word);
    for (const s of stems) if (!same.stems.includes(s)) same.stems.push(s);
  }
  return terms;
}

/** What the stemmed index knows: documents per stem, and whether any stem starts with a prefix. */
export interface StemVocab {
  docs(stems: string[]): Map<string, number>;
  hasPrefix(prefix: string): boolean;
}

export interface MatchPlan {
  /** Every term required (stemmed index); null when there is only one term. */
  strict: string | null;
  /** Any term (stemmed index). */
  loose: string | null;
  /** Any word as typed (plain index). */
  plain: string | null;
}

const quote = (s: string, prefix = false) => `"${s.replaceAll('"', '""')}"${prefix ? '*' : ''}`;
const anyOf = (parts: string[]) => (parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0]);

/**
 * FTS5 MATCH expressions for a query. Every word is quoted, so FTS operators in the text
 * are inert. With the stemmed index's vocabulary, words it lacks entirely are dropped (or
 * matched as a prefix, for a partial word) and the rarest MAX_TERMS are kept; without it
 * (index still building) the longest are. A query of only stopwords searches its words
 * as typed, so it still finds something.
 */
export function matchPlan(q: string, vocab: StemVocab | null): MatchPlan | null {
  const terms = queryTerms(q);
  if (!terms.length) {
    const typed = [...new Map(tokens(q).map((w) => [fold(w), w])).values()].slice(0, MAX_TERMS);
    return typed.length ? { strict: null, loose: null, plain: typed.map((w) => quote(w)).join(' OR ') } : null;
  }

  let picked: { term: QueryTerm; prefix: boolean }[];
  if (vocab) {
    const docs = vocab.docs(terms.flatMap((t) => t.stems));
    const ranked: { term: QueryTerm; prefix: boolean; df: number }[] = [];
    for (const term of terms) {
      const df = Math.max(0, ...term.stems.map((s) => docs.get(s) ?? 0));
      if (df > 0) ranked.push({ term, prefix: false, df });
      else if (term.stems.some((s) => s.length >= MIN_PREFIX && vocab.hasPrefix(s))) ranked.push({ term, prefix: true, df: 1 });
    }
    picked = ranked.sort((a, b) => a.df - b.df).slice(0, MAX_TERMS);
  } else {
    picked = [...terms].sort((a, b) => b.words[0].length - a.words[0].length).slice(0, MAX_TERMS).map((term) => ({ term, prefix: false }));
  }
  if (!picked.length) return null;

  const groups = picked.map(({ term, prefix }) => anyOf(term.stems.map((s) => quote(s, prefix))));
  const typed = picked.flatMap(({ term, prefix }) => term.words.map((w) => quote(w, prefix)));
  return {
    strict: groups.length > 1 ? groups.join(' AND ') : null,
    loose: groups.join(' OR '),
    plain: typed.join(' OR '),
  };
}
