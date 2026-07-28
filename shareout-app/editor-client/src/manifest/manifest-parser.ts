/**
 * ShareOut Manifest Parser (editor).
 *
 * Canonical parsing + types live in the shared editor-readiness module so the editor
 * and the worker interpret manifests identically. This file re-exports them and adds
 * the editor-only helpers (DOM extraction, bindable-key expansion, data-model summary).
 */

import {
  MANIFEST_SCRIPT_TYPE,
  parseManifestJson,
  type ParsedManifest,
  type ShareOutManifest,
} from '../../../shared/editor-readiness/manifest';

export {
  MANIFEST_SCRIPT_TYPE,
  MANIFEST_VERSION,
  parseManifest,
  parseManifestJson,
} from '../../../shared/editor-readiness/manifest';
export type {
  ManifestJsonSource,
  ManifestTableField,
  ManifestTableSource,
  ManifestComputed,
  ManifestFormatter,
  ManifestSources,
  ShareOutManifest,
  ParsedManifest,
} from '../../../shared/editor-readiness/manifest';

export function extractManifestFromDocument(doc: Document): ParsedManifest | null {
  const scriptEl = doc.querySelector(`script[type="${MANIFEST_SCRIPT_TYPE}"]`);
  if (!scriptEl) return null;
  return parseManifestJson(scriptEl.textContent);
}

export function getAllBindableKeys(parsed: ParsedManifest): string[] {
  const keys: string[] = [];

  for (const jsonKey of parsed.jsonKeys) {
    keys.push(`json:${jsonKey}`);
    const source = parsed.manifest.sources?.json?.[jsonKey];
    if (source?.default) {
      addNestedKeys(keys, `json:${jsonKey}`, source.default);
    }
  }

  for (const tableName of parsed.tableNames) {
    const table = parsed.manifest.sources?.tables?.[tableName];
    if (table?.schema) {
      for (const field of table.schema) {
        keys.push(`table:${tableName}:row:$id:${field.name}`);
        keys.push(`table:${tableName}:sum:${field.name}`);
        keys.push(`table:${tableName}:count:${field.name}`);
        keys.push(`table:${tableName}:avg:${field.name}`);
        keys.push(`table:${tableName}:min:${field.name}`);
        keys.push(`table:${tableName}:max:${field.name}`);
      }
    }
  }

  for (const computedName of parsed.computedNames) {
    keys.push(`computed:${computedName}`);
  }

  return keys;
}

function addNestedKeys(keys: string[], prefix: string, obj: Record<string, unknown>, depth = 0): void {
  if (depth > 5) return;
  for (const key of Object.keys(obj)) {
    const fullKey = `${prefix}.${key}`;
    keys.push(fullKey);
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      addNestedKeys(keys, fullKey, obj[key] as Record<string, unknown>, depth + 1);
    }
  }
}

export function validateBindingAgainstManifest(binding: string, parsed: ParsedManifest): string | null {
  const parts = binding.split(':');
  const type = parts[0];

  switch (type) {
    case 'json': {
      const keyRoot = parts[1]?.split('.')[0];
      if (!keyRoot || !parsed.jsonKeys.includes(keyRoot)) {
        return `JSON key "${keyRoot}" not declared in manifest`;
      }
      break;
    }
    case 'table': {
      const tableName = parts[1];
      if (!tableName || !parsed.tableNames.includes(tableName)) {
        return `Table "${tableName}" not declared in manifest`;
      }
      break;
    }
    case 'computed': {
      const computedName = parts[1];
      if (!computedName || !parsed.computedNames.includes(computedName)) {
        return `Computed value "${computedName}" not declared in manifest`;
      }
      break;
    }
  }

  return null;
}

export function getDefaultValue(binding: string, parsed: ParsedManifest): unknown {
  const parts = binding.split(':');
  const type = parts[0];

  if (type === 'json') {
    const keyParts = parts.slice(1).join(':').split('.');
    const rootKey = keyParts[0];
    const source = parsed.manifest.sources?.json?.[rootKey];
    if (!source?.default) return undefined;

    let value: unknown = source.default;
    for (let i = 1; i < keyParts.length; i++) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[keyParts[i]];
      } else {
        return undefined;
      }
    }
    return value;
  }

  return undefined;
}

/** Compact, JSON-serializable summary of the manifest's declared data model. */
export interface ManifestSummary {
  json?: Array<{ key: string; type: string }>;
  tables?: Array<{ name: string; fields: Array<{ name: string; type: string; primary?: boolean }> }>;
  computed?: Array<{ name: string; formula?: string }>;
  formatters?: string[];
  realtime?: string[];
  blobs?: string[];
}

/** Build the data-model summary used by both the AI chat context and the Data tab catalog. */
export function buildManifestSummary(parsed: ParsedManifest | null | undefined): ManifestSummary | null {
  if (!parsed) return null;
  const m: ShareOutManifest = parsed.manifest;
  const summary: ManifestSummary = {};

  const jsonSources = m.sources?.json;
  if (jsonSources) {
    const json = Object.keys(jsonSources).map((key) => {
      const def = jsonSources[key]?.default;
      const type = def === undefined ? 'value' : Array.isArray(def) ? 'array' : typeof def;
      return { key, type };
    });
    if (json.length) summary.json = json;
  }

  const tableSources = m.sources?.tables;
  if (tableSources) {
    const tables = Object.keys(tableSources).map((name) => ({
      name,
      fields: (tableSources[name]?.schema || []).map((field) => ({
        name: field.name,
        type: field.type,
        primary: field.primary,
      })),
    }));
    if (tables.length) summary.tables = tables;
  }

  if (m.computed) {
    const computed = Object.keys(m.computed).map((name) => ({
      name,
      formula: m.computed?.[name]?.formula,
    }));
    if (computed.length) summary.computed = computed;
  }

  if (parsed.formatterNames?.length) summary.formatters = parsed.formatterNames;
  if (parsed.realtimeDocs?.length) summary.realtime = parsed.realtimeDocs;
  if (parsed.blobNames?.length) summary.blobs = parsed.blobNames;

  const hasAny =
    summary.json || summary.tables || summary.computed || summary.formatters || summary.realtime || summary.blobs;
  return hasAny ? summary : null;
}
