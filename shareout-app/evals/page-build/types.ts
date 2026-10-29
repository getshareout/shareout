/** Shapes shared by the page-build eval: the item set, what a scorer reports, and the results file. */

export type Lang = 'en' | 'es';

/** Named detectors over the page's source text; each is a heuristic, listed in scorers.ts. */
export type Feature = 'chart' | 'validation' | 'formula' | 'responsive' | 'persistence';

export interface Expect {
  /** Tables the manifest must declare under sources.tables. */
  tables?: string[];
  /** At least this many fillable controls (input/select/textarea; not hidden or buttons). */
  minFormFields?: number;
  features?: Feature[];
  /** Case-insensitive regex sources; each must match the page's source text. */
  patterns?: string[];
  /** At least this many <section> / <h2> blocks. */
  minSections?: number;
  /** At least this many characters of source across the page's text files. */
  minChars?: number;
  /** The language of the visible text. */
  language?: Lang;
  /** Edit items: strings from the seed page that must survive the change. */
  preserve?: string[];
}

export interface SeedFile {
  path: string;
  content: string;
}

export interface EvalItem {
  id: string;
  language: Lang;
  tags: string[];
  /** build = a new page through create_artifact; edit = change the seed page through edit_page. */
  kind: 'build' | 'edit';
  prompt: string;
  /** Edit items: the page published before the request. */
  seed?: SeedFile[];
  expect: Expect;
}

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface IssueLine {
  rule: string;
  severity: string;
  message: string;
  where?: string;
}

export interface StaticScore {
  errors: number;
  warnings: number;
  issues: IssueLine[];
}

export type VerifyStatus = 'pass' | 'warn' | 'fail' | 'partial';

export interface VerifyScore {
  status: VerifyStatus;
  errors: number;
  warnings: number;
  issues: IssueLine[];
}

export interface Usage {
  tokens: number;
  costUsd: number;
}

export interface RunRecord {
  itemId: string;
  run: number;
  /** The page was built (or edited) and its files were read back. */
  built: boolean;
  /** Why it was not, in words; also set when a step before scoring failed. */
  error?: string;
  artifactId?: string;
  version?: number;
  wallMs: number;
  steps: string[];
  buildText?: string;
  static: StaticScore | null;
  verify: VerifyScore | null;
  /** Why verify gave no score (not asked, or the call failed). */
  verifyNote?: string;
  checks: Check[];
  /** Spend the instance's usage ledger exposes for this run (see README: page_build is not in it today). */
  usage: Usage | null;
  passed: boolean;
}

export interface Aggregate {
  runs: number;
  built: number;
  passed: number;
  passRate: number;
  /** Mean share of expectation checks that held, over built runs. */
  meanCheckRate: number;
  meanStaticIssues: number;
  meanVerifyIssues: number | null;
  verified: number;
  wallMs: { mean: number; p50: number; max: number; total: number };
  usage: Usage | null;
}

export interface EvalResults {
  schema: 1;
  setVersion: number;
  startedAt: string;
  finishedAt: string;
  origin: string;
  workspace: string;
  repeat: number;
  verify: boolean;
  runs: RunRecord[];
  aggregate: Aggregate;
  /** Every artifact the eval created (builds and seeds), for --cleanup. */
  created: string[];
}
