import { isMap, parseDocument } from 'yaml';
import type { Env } from '../types';
import { parseCatalog, parseEntry, splitFrontmatter } from './parse';
import { findEntry } from './lineage';
import {
  catalogContentBytes, listCatalogFiles, upsertCatalogFile, MAX_CATALOG_FILE_BYTES, type CatalogEditorKind,
} from './store';
import { metricWriteIssue } from './metrics/spec';
import type { CatalogEntry } from './types';

// Editing an existing entry in place: the Catalog lens's Edit form, PATCH …/entries/{id}
// and the assistant's catalog_update all go through updateCatalogEntry. `id` and `kind`
// stay fixed (lineage, aliases and certifications point at them) and `status` moves only
// through certification, so an edit can't certify itself. Every other frontmatter key and
// comment is kept (the YAML library may normalize quoting and spacing).

const TEXT_FIELDS = ['title', 'domain', 'owner'] as const;
const LIST_FIELDS = ['tags', 'aliases', 'terms'] as const;
export const EDITABLE_FIELDS = [...TEXT_FIELDS, ...LIST_FIELDS, 'body'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

const MAX_TEXT_CHARS = 300;
const MAX_LIST_ITEMS = 100;

export interface CatalogEntryEdit {
  title?: string;
  /** null or '' removes the key. */
  domain?: string | null;
  owner?: string | null;
  /** [] removes the key. */
  tags?: string[];
  aliases?: string[];
  /** Related glossary term ids. */
  terms?: string[];
  /** Markdown prose after the frontmatter. */
  body?: string;
}

export interface CatalogEditError {
  ok: false;
  status: 400 | 404 | 413;
  code: 'INVALID_EDIT' | 'NOT_FOUND' | 'INVALID_ENTRY' | 'FILE_TOO_LARGE' | 'INVALID_METRIC_SPEC';
  message: string;
  param?: string;
}

export type CatalogEditResult =
  | { ok: true; entry: CatalogEntry; path: string; changed: EditableField[] }
  | CatalogEditError;

function invalid(message: string, param?: string): CatalogEditError {
  return { ok: false, status: 400, code: 'INVALID_EDIT', message, ...(param ? { param } : {}) };
}

/** Validate an edit from an untrusted caller (JSON body, tool input). Unknown keys are refused. */
export function normalizeEntryEdit(input: unknown): { edit: CatalogEntryEdit } | CatalogEditError {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('Send the fields to change as an object.');
  const raw = input as Record<string, unknown>;
  const unknown = Object.keys(raw).filter(k => !(EDITABLE_FIELDS as readonly string[]).includes(k));
  if (unknown.length) {
    return invalid(`Can't edit ${unknown.join(', ')}. Editable fields: ${EDITABLE_FIELDS.join(', ')}.`, unknown[0]);
  }
  const edit: CatalogEntryEdit = {};
  for (const key of TEXT_FIELDS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v !== null && typeof v !== 'string') return invalid(`${key} must be text.`, key);
    const s = (v ?? '').trim();
    if (s.length > MAX_TEXT_CHARS) return invalid(`${key} is longer than ${MAX_TEXT_CHARS} characters.`, key);
    if (key === 'title') {
      if (!s) return invalid('title can’t be empty.', key);
      edit.title = s;
    } else {
      edit[key] = s || null;
    }
  }
  for (const key of LIST_FIELDS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) return invalid(`${key} must be a list of text.`, key);
    const items = [...new Set((v as string[]).map(x => x.trim()).filter(Boolean))];
    if (items.length > MAX_LIST_ITEMS) return invalid(`${key} has more than ${MAX_LIST_ITEMS} items.`, key);
    if (items.some(x => x.length > MAX_TEXT_CHARS)) return invalid(`An item in ${key} is longer than ${MAX_TEXT_CHARS} characters.`, key);
    edit[key] = items;
  }
  if ('body' in raw) {
    if (typeof raw.body !== 'string') return invalid('body must be text.', 'body');
    edit.body = raw.body.trim();
  }
  if (!Object.keys(edit).length) return invalid(`Nothing to change. Editable fields: ${EDITABLE_FIELDS.join(', ')}.`);
  return { edit };
}

/** The file with the edit applied, or null when its frontmatter isn't a YAML map. */
export function applyEntryEdit(raw: string, edit: CatalogEntryEdit): string | null {
  const parts = splitFrontmatter(raw);
  if (!parts) return null;
  const doc = parseDocument(parts.yaml);
  if (doc.errors.length || !isMap(doc.contents)) return null;
  for (const key of TEXT_FIELDS) {
    if (!(key in edit)) continue;
    const v = edit[key];
    if (v) doc.set(key, v);
    else doc.delete(key);
  }
  for (const key of LIST_FIELDS) {
    const v = edit[key];
    if (!v) continue;
    if (!v.length) { doc.delete(key); continue; }
    const node = doc.createNode(v);
    node.flow = true;
    doc.set(key, node);
  }
  const body = edit.body !== undefined ? edit.body : parts.body.trim();
  return `---\n${doc.toString({ flowCollectionPadding: false }).trimEnd()}\n---\n${body ? `\n${body}\n` : ''}`;
}

function changedFields(before: CatalogEntry, after: CatalogEntry): EditableField[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return EDITABLE_FIELDS.filter(f => !same(before[f], after[f]));
}

/**
 * Apply `edit` to the entry `entryId` (or one of its aliases) and store it as a manual
 * file, so connector re-seeds never overwrite it. A certified entry becomes "changed
 * since certification" because its content hash moves.
 */
export async function updateCatalogEntry(
  env: Env,
  workspaceId: string,
  entryId: string,
  edit: CatalogEntryEdit,
  editor: { id: string; kind: CatalogEditorKind }
): Promise<CatalogEditResult> {
  const files = await listCatalogFiles(env, workspaceId);
  const before = findEntry(parseCatalog(files).entries, entryId);
  if (!before) return { ok: false, status: 404, code: 'NOT_FOUND', message: `No catalog entry with id “${entryId}”.` };
  const file = files.find(f => f.path === before.path);
  const content = file ? applyEntryEdit(file.content, edit) : null;
  if (!file || content === null) {
    return { ok: false, status: 400, code: 'INVALID_ENTRY', message: `${before.path} has frontmatter this editor can't rewrite; edit the file instead.` };
  }
  const parsed = parseEntry(before.path, content);
  if (!parsed.entry) return { ok: false, status: 400, code: 'INVALID_ENTRY', message: parsed.issue?.message ?? 'The edit would break this entry.' };
  if (catalogContentBytes(content) > MAX_CATALOG_FILE_BYTES) {
    return { ok: false, status: 413, code: 'FILE_TOO_LARGE', message: `The entry would be larger than ${MAX_CATALOG_FILE_BYTES / 1024} KB.`, param: 'body' };
  }
  const specIssue = metricWriteIssue(before.path, content);
  if (specIssue) return { ok: false, status: 400, code: 'INVALID_METRIC_SPEC', message: specIssue.message, ...(specIssue.param ? { param: specIssue.param } : {}) };
  const changed = changedFields(before, parsed.entry);
  // Nothing an editor can see changed: leave the file (and its source and author) alone.
  if (changed.length) {
    await upsertCatalogFile(env, workspaceId, {
      path: before.path,
      content,
      source: 'manual',
      updatedBy: editor.id,
      updatedByKind: editor.kind,
    });
  }
  return { ok: true, entry: parsed.entry, path: before.path, changed };
}
