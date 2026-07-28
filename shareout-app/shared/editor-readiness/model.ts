/**
 * Editor-Readiness shared model.
 *
 * Parser-agnostic data structure describing the editor-relevant structure of an
 * artifact's HTML. Two adapters produce it — a DOM adapter (editor, browser) and an
 * HTMLRewriter adapter (worker, publish) — and one shared rule set runs against it,
 * so the definition of "editor-ready" can never drift between the two environments.
 *
 * `ref` carries the source element for the DOM adapter (used by the editor to
 * navigate to the offending node). The worker adapter leaves it undefined; it is
 * non-serializable and drops out of JSON, which is what the publish response stores.
 */

export type IssueLevel = 'error' | 'warning' | 'info';
export type IssueCategory =
  | 'manifest'
  | 'binding'
  | 'form'
  | 'action'
  | 'conditional'
  | 'navigation'
  | 'orphan'
  | 'provenance';

export interface Finding {
  /** Per-instance id, e.g. `binding-undeclared-3` (stable for the same input). */
  id: string;
  /** Stable rule id, e.g. `binding-undeclared` (used to key the `disables` label). */
  rule: string;
  level: IssueLevel;
  category: IssueCategory;
  message: string;
  suggestion?: string;
  /** Editor feature this gap disables (attached by evaluate()). */
  disables?: string;
  /** Opaque source-element handle; populated only by the DOM adapter. */
  ref?: unknown;
}

interface WithRef {
  ref?: unknown;
}

export interface ReadinessModel {
  manifestPresent: boolean;
  manifest: {
    valid: boolean;
    errors: string[];
    jsonKeys: string[];
    tableNames: string[];
    connectionNames: string[];
    computedNames: string[];
    /** Declared json/table sources missing a `default` (editor previews them empty). */
    sourcesWithoutDefaults: string[];
    /** Live/derived sources missing provenance (query/description/replication). */
    sourcesWithoutProvenance: string[];
    /** Element→source feed mappings declared in the manifest. */
    feedCount: number;
  };
  /** Count of elements tagged with `data-shareout-source` (per-element provenance). */
  sourceTaggedCount: number;
  /** Declared id sets, for existence checks. */
  pageIds: Set<string>;
  sectionIds: Set<string>;
  modalIds: Set<string>;
  tabIds: Set<string>;
  fieldIds: Set<string>;
  errorFieldIds: Set<string>;
  /** Document-ordered collections (one entry per matching element). */
  bindings: Array<{ expr: string } & WithRef>;
  conditionals: Array<{ expr: string } & WithRef>;
  actions: Array<{ type: string; target: string } & WithRef>;
  links: Array<{ target: string } & WithRef>;
  modals: Array<{ id: string } & WithRef>;
  forms: Array<{ id: string; hasSubmitAttr: boolean; hasSubmitDescendant: boolean } & WithRef>;
  cases: Array<{ insideSwitch: boolean } & WithRef>;
  fields: Array<{ insideForm: boolean }>;
  errorElements: Array<{ fieldId: string } & WithRef>;
  requiredFields: Array<{ fieldId: string | null } & WithRef>;
  counts: {
    pages: number;
    sections: number;
    bindings: number;
    templates: number;
  };
}

export interface ReadinessProfile {
  manifest: 'valid' | 'invalid' | 'missing';
  /** At least one declared page (the editor outline needs this). */
  outline: boolean;
  counts: {
    pages: number;
    sections: number;
    bindings: number;
    templates: number;
  };
  summary: { errors: number; warnings: number; infos: number };
  findings: Finding[];
}
