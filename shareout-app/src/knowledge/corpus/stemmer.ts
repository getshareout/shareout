// Stemmers for the corpus keyword index (lexical.ts). Both take one lowercase word with
// its accents already removed: queries are typed without accents as often as with, so
// "contratacion" and "contratación" must reach the same stem.
//
// stemEs is the Snowball Spanish algorithm (snowballstem.org/algorithms/spanish) with its
// suffix lists folded the same way (ación → acion, ía → ia). Folding merges a few endings
// the original tells apart by accent (comerá/carrera both lose "era"); docs and queries
// go through the same function, so they still meet.
//
// stemEn is a light English stemmer: Porter's inflectional steps only (plurals, -ed,
// -ing, -y, final -e), enough for budget/budgets and approve/approved/approving.

const isVowel = (c: string | undefined) => c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u';

type Ending = Map<string, number>;

/** Suffix table keyed by ending, plus its lengths longest-first, for longest-match lookup. */
function endings(groups: Record<number, string>): { map: Ending; lengths: number[] } {
  const map: Ending = new Map();
  for (const [group, list] of Object.entries(groups)) for (const s of list.split(' ')) map.set(s, Number(group));
  return { map, lengths: [...new Set([...map.keys()].map((s) => s.length))].sort((a, b) => b - a) };
}

/** Longest suffix of `w` in `table` that starts at or after `from`. */
function longest(w: string, table: { map: Ending; lengths: number[] }, from = 0): [string, number] | null {
  for (const len of table.lengths) {
    if (w.length - len < from) continue;
    const s = w.slice(-len);
    const group = table.map.get(s);
    if (group !== undefined) return [s, group];
  }
  return null;
}

const PRONOUN = endings({ 0: 'me se sela selo selas selos la le lo las les los nos' });
const PRONOUN_HOST = endings({ 0: 'iendo ando ar er ir', 1: 'yendo' });
const STANDARD = endings({
  0: 'anza anzas ico ica icos icas ismo ismos able ables ible ibles ista istas oso osa osos osas amiento amientos imiento imientos',
  1: 'adora ador acion adoras adores aciones ante antes ancia ancias',
  2: 'logia logias',
  3: 'ucion uciones',
  4: 'encia encias',
  5: 'amente',
  6: 'mente',
  7: 'idad idades',
  8: 'iva ivo ivas ivos',
});
const AMENTE_PREV = endings({ 0: 'iv os ic ad' });
const MENTE_PREV = endings({ 0: 'ante able ible' });
const IDAD_PREV = endings({ 0: 'abil ic iv' });
const Y_VERB = endings({ 0: 'ya ye yan yen yeron yendo yo yas yes yais yamos' });
// Accented verb endings whose folded form is also a common ending of other words are left
// out: ía/ió/í would split servicio/servicios and necesario/necesaria, erán/irán would cut
// generan and retiran to "gen" and "ret". What is left is the original's unaccented list
// plus the long, unambiguous folded endings (arían, ábamos, …).
const VERB = endings({
  0: 'en es emos',
  1: 'arian ariamos aremos aran aras ara erian eriamos eremos irian iriamos iremos aba ada ida iera ad ed id ' +
    'ase iese aste iste an aban ieran asen iesen aron ieron ado ido ando iendo ar er ir as abas adas idas ' +
    'ieras ases ieses abais arais ierais aseis ieseis asteis isteis ados idos amos abamos imos ieramos ' +
    'iesemos asemos',
});
const RESIDUAL = endings({ 0: 'os a o', 1: 'e' });

/** RV, R1 and R2 as start offsets (Snowball Spanish). */
function regions(w: string): [number, number, number] {
  const n = w.length;
  let rv = n;
  if (n >= 2) {
    if (!isVowel(w[1])) {
      for (let i = 2; i < n; i++) if (isVowel(w[i])) { rv = i + 1; break; }
    } else if (isVowel(w[0])) {
      for (let i = 2; i < n; i++) if (!isVowel(w[i])) { rv = i + 1; break; }
    } else {
      rv = Math.min(3, n);
    }
  }
  const after = (from: number) => {
    for (let i = from + 1; i < n; i++) if (!isVowel(w[i]) && isVowel(w[i - 1])) return i + 1;
    return n;
  };
  const r1 = after(0);
  return [rv, r1, after(r1)];
}

/** Drop `prev` (longest of the table) when it sits in R2. */
function dropPrev(w: string, table: { map: Ending; lengths: number[] }, r2: number): string {
  const m = longest(w, table, r2);
  return m ? w.slice(0, -m[0].length) : w;
}

function standardSuffix(w: string, r1: number, r2: number): string | null {
  const m = longest(w, STANDARD);
  if (!m) return null;
  const [s, group] = m;
  const start = w.length - s.length;
  const base = w.slice(0, start);
  if (group === 5) {
    if (start < r1) return null;
    const prev = longest(base, AMENTE_PREV, r2);
    if (!prev) return base;
    const cut = base.slice(0, -prev[0].length);
    return prev[0] === 'iv' && cut.endsWith('at') && cut.length - 2 >= r2 ? cut.slice(0, -2) : cut;
  }
  if (start < r2) return null;
  switch (group) {
    case 1: return base.endsWith('ic') && base.length - 2 >= r2 ? base.slice(0, -2) : base;
    case 2: return `${base}log`;
    case 3: return `${base}u`;
    case 4: return `${base}ente`;
    case 6: return dropPrev(base, MENTE_PREV, r2);
    case 7: return dropPrev(base, IDAD_PREV, r2);
    case 8: return base.endsWith('at') && base.length - 2 >= r2 ? base.slice(0, -2) : base;
    default: return base;
  }
}

export function stemEs(word: string): string {
  if (word.length < 3) return word;
  const [rv, r1, r2] = regions(word);
  let w = word;

  const pronoun = longest(w, PRONOUN);
  if (pronoun) {
    const host = w.slice(0, -pronoun[0].length);
    const verb = longest(host, PRONOUN_HOST, rv);
    if (verb && (verb[1] === 0 || host.slice(0, -verb[0].length).endsWith('u'))) w = host;
  }

  const standard = standardSuffix(w, r1, r2);
  if (standard !== null) {
    w = standard;
  } else {
    const y = longest(w, Y_VERB, rv);
    if (y && w.slice(0, -y[0].length).endsWith('u')) {
      w = w.slice(0, -y[0].length);
    } else {
      const verb = longest(w, VERB, rv);
      if (verb) {
        w = w.slice(0, -verb[0].length);
        if (verb[1] === 0 && w.endsWith('gu')) w = w.slice(0, -1);
      }
    }
  }

  const residual = longest(w, RESIDUAL, rv);
  if (residual) {
    w = w.slice(0, -residual[0].length);
    if (residual[1] === 1 && w.endsWith('gu') && w.length - 1 >= rv) w = w.slice(0, -1);
  }
  return w;
}

// ----- English: Porter steps 1a–1c and 5 -----

function isConsonant(w: string, i: number): boolean {
  const c = w[i];
  if (isVowel(c)) return false;
  return c === 'y' ? i === 0 || !isConsonant(w, i - 1) : true;
}

/** Porter's m: the number of vowel→consonant runs. */
function measure(w: string): number {
  let m = 0;
  let i = 0;
  while (i < w.length && isConsonant(w, i)) i++;
  while (i < w.length) {
    while (i < w.length && !isConsonant(w, i)) i++;
    if (i >= w.length) break;
    m++;
    while (i < w.length && isConsonant(w, i)) i++;
  }
  return m;
}

const hasVowel = (w: string) => {
  for (let i = 0; i < w.length; i++) if (!isConsonant(w, i)) return true;
  return false;
};
const doubleConsonant = (w: string) => w.length > 1 && w.at(-1) === w.at(-2) && isConsonant(w, w.length - 1);
/** Ends consonant-vowel-consonant, the last not w, x or y (hop, not hoop or bow). */
const cvc = (w: string) => {
  const n = w.length;
  return n > 2 && isConsonant(w, n - 1) && !isConsonant(w, n - 2) && isConsonant(w, n - 3) && !/[wxy]$/.test(w);
};

export function stemEn(word: string): string {
  if (word.length < 3) return word;
  let w = word;
  if (w.endsWith('sses') || w.endsWith('ies')) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && hasVowel(w.slice(0, -2))) w = w.slice(0, -1);

  if (w.endsWith('eed')) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else {
    const cut = w.endsWith('ed') ? 2 : w.endsWith('ing') ? 3 : 0;
    if (cut && hasVowel(w.slice(0, -cut))) {
      w = w.slice(0, -cut);
      if (/(at|bl|iz)$/.test(w)) w += 'e';
      else if (doubleConsonant(w) && !/[lsz]$/.test(w)) w = w.slice(0, -1);
      else if (measure(w) === 1 && cvc(w)) w += 'e';
    }
  }

  if (w.endsWith('y') && w.length > 2 && hasVowel(w.slice(0, -1))) w = `${w.slice(0, -1)}i`;
  if (w.endsWith('e')) {
    const base = w.slice(0, -1);
    const m = measure(base);
    if (m > 1 || (m === 1 && !cvc(base))) w = base;
  }
  if (w.endsWith('ll') && measure(w) > 1) w = w.slice(0, -1);
  return w;
}
