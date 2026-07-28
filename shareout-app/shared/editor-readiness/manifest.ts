/**
 * Shared manifest parser — the single source for turning a `shareout/manifest`
 * script into a ParsedManifest. Used by both the worker (from raw HTML) and the
 * editor (from a DOM script element), so manifest interpretation cannot drift.
 */

export const MANIFEST_SCRIPT_TYPE = 'shareout/manifest';
export const MANIFEST_VERSION = '2.0';

/**
 * Optional provenance metadata any source can carry so viewers (and the SDK
 * "Data sources" drawer) can answer "where does this data come from?" without
 * the artifact hand-rolling the explanation. Entirely advisory — declaring none
 * keeps the source valid; declaring them powers the drawer and quiets the
 * provenance readiness findings.
 */
export interface ManifestProvenance {
  /** Human label for the dataset, e.g. "Customer activity (90d)". */
  label?: string;
  /** Plain-language description of what the dataset is. */
  description?: string;
  /** The exact query/script that produced the data (SQL, API call, build step). */
  query?: string;
  /** Underlying warehouse/source tables this dataset reads. */
  tables?: string[];
  /** Refresh cadence in words, e.g. "daily 12:00 UTC" or "manual". */
  refresh?: string;
  /** As-of timestamp/date for the current snapshot (ISO or human). */
  as_of?: string;
  /** How to rebuild this dataset from scratch. */
  replication?: ManifestReplication;
}

export interface ManifestReplication {
  /** Build script / command that regenerates the data, e.g. "python build_scorecard.py". */
  build?: string;
  /** Publish command, e.g. "node publish_scorecard.mjs". */
  publish?: string;
  /** Where credentials live (path/location, never the secret itself). */
  credentials?: string;
  /** Free-form extra steps. */
  notes?: string;
}

export interface ManifestJsonSource extends ManifestProvenance {
  default?: Record<string, unknown>;
}

export interface ManifestTableField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  primary?: boolean;
  required?: boolean;
}

export interface ManifestTableSource extends ManifestProvenance {
  schema?: ManifestTableField[];
  default?: Record<string, unknown>[];
}

export interface ManifestConnectionSource extends ManifestProvenance {
  /** Sample rows the visual editor previews for this live connector (no live query in the editor). */
  default?: unknown[];
}

/**
 * Links a UI element (chart/table) to the source key that feeds it. Powers the
 * SDK's per-element "where from?" badge. `element` is a CSS selector or element id;
 * `source` is a `kind:key` reference such as `connection:warehouse` or `json:revenue`.
 */
export interface ManifestFeed {
  element: string;
  source: string;
  note?: string;
}

export interface ManifestSources {
  json?: Record<string, ManifestJsonSource>;
  tables?: Record<string, ManifestTableSource>;
  connections?: Record<string, ManifestConnectionSource>;
  blobs?: string[];
  realtime?: string[];
}

export interface ManifestComputed {
  formula: string;
  display?: string;
}

export interface ManifestFormatter {
  locale?: string;
  currency?: string;
  decimals?: number;
  format?: string;
}

export interface ShareOutManifest {
  version: string;
  sources?: ManifestSources;
  computed?: Record<string, ManifestComputed>;
  formatters?: Record<string, ManifestFormatter>;
  /** Maps UI elements (charts/tables) to the source that feeds them. */
  feeds?: ManifestFeed[];
}

export interface ParsedManifest {
  manifest: ShareOutManifest;
  valid: boolean;
  errors: string[];
  jsonKeys: string[];
  tableNames: string[];
  connectionNames: string[];
  blobNames: string[];
  realtimeDocs: string[];
  computedNames: string[];
  formatterNames: string[];
  feeds: ManifestFeed[];
}

function emptyParsed(errors: string[]): ParsedManifest {
  return {
    manifest: { version: MANIFEST_VERSION },
    valid: false,
    errors,
    jsonKeys: [],
    tableNames: [],
    connectionNames: [],
    blobNames: [],
    realtimeDocs: [],
    computedNames: [],
    formatterNames: [],
    feeds: [],
  };
}

/**
 * Core: parse already-extracted manifest JSON text into a ParsedManifest.
 * Both `parseManifest` (HTML string) and the editor's `extractManifestFromDocument`
 * (DOM textContent) funnel through here.
 */
export function parseManifestJson(jsonContent: string | null | undefined): ParsedManifest {
  const trimmed = jsonContent?.trim();
  if (!trimmed) {
    return emptyParsed(['Empty manifest script']);
  }

  let manifest: ShareOutManifest;
  try {
    manifest = JSON.parse(trimmed);
  } catch (e) {
    return emptyParsed([`Invalid JSON in manifest: ${e instanceof Error ? e.message : 'Parse error'}`]);
  }

  const errors: string[] = [];
  if (manifest.version !== MANIFEST_VERSION) {
    errors.push(`Manifest version "${manifest.version}" does not match expected "${MANIFEST_VERSION}"`);
  }

  return {
    manifest,
    valid: errors.length === 0,
    errors,
    jsonKeys: manifest.sources?.json ? Object.keys(manifest.sources.json) : [],
    tableNames: manifest.sources?.tables ? Object.keys(manifest.sources.tables) : [],
    connectionNames: manifest.sources?.connections ? Object.keys(manifest.sources.connections) : [],
    blobNames: manifest.sources?.blobs || [],
    realtimeDocs: manifest.sources?.realtime || [],
    computedNames: manifest.computed ? Object.keys(manifest.computed) : [],
    formatterNames: manifest.formatters ? Object.keys(manifest.formatters) : [],
    feeds: Array.isArray(manifest.feeds) ? manifest.feeds : [],
  };
}

/** Parse the manifest out of a raw HTML string. Returns null if no manifest script exists. */
export function parseManifest(html: string): ParsedManifest | null {
  const scriptMatch = html.match(
    /<script\s+type=["']shareout\/manifest["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!scriptMatch) return null;
  return parseManifestJson(scriptMatch[1]);
}

/**
 * Declared json/table/connection sources that lack a `default` sample value. The
 * visual editor seeds its preview from these defaults, so a source without one previews
 * empty. Returns e.g. `["table:rooms", "json:revenue", "connection:warehouse"]`.
 */
export function sourcesWithoutDefaults(parsed: ParsedManifest | null): string[] {
  if (!parsed) return [];
  const out: string[] = [];
  const json = parsed.manifest.sources?.json ?? {};
  for (const key of Object.keys(json)) {
    if (json[key]?.default === undefined) out.push(`json:${key}`);
  }
  const tables = parsed.manifest.sources?.tables ?? {};
  for (const name of Object.keys(tables)) {
    if (tables[name]?.default === undefined) out.push(`table:${name}`);
  }
  const connections = parsed.manifest.sources?.connections ?? {};
  for (const name of Object.keys(connections)) {
    if (connections[name]?.default === undefined) out.push(`connection:${name}`);
  }
  return out;
}

/** A source carries provenance if it declares any of query/description/replication. */
export function hasProvenance(src: ManifestProvenance | undefined): boolean {
  if (!src) return false;
  return Boolean(src.query || src.description || src.replication);
}

/**
 * Live/derived sources (connections, json, tables) that declare no provenance
 * (no query/description/replication). These are the datasets a viewer can't trace.
 * Returns e.g. `["connection:warehouse", "json:revenue"]`.
 */
export function sourcesWithoutProvenance(parsed: ParsedManifest | null): string[] {
  if (!parsed) return [];
  const out: string[] = [];
  const connections = parsed.manifest.sources?.connections ?? {};
  for (const name of Object.keys(connections)) {
    if (!hasProvenance(connections[name])) out.push(`connection:${name}`);
  }
  const json = parsed.manifest.sources?.json ?? {};
  for (const key of Object.keys(json)) {
    if (!hasProvenance(json[key])) out.push(`json:${key}`);
  }
  const tables = parsed.manifest.sources?.tables ?? {};
  for (const name of Object.keys(tables)) {
    if (!hasProvenance(tables[name])) out.push(`table:${name}`);
  }
  return out;
}
