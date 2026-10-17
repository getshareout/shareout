/**
 * Templates: a scrubbed, versioned snapshot of an artifact or a folder of artifacts
 * that installs into any workspace. See migrations/0020_artifact_templates.sql.
 */
import type { ArtifactType, ImportedSource } from '../types';

const oneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/** private: the home workspace (or its creator, in a personal space). shared: plus the
 *  workspaces in template_shares. instance: every workspace on the instance (admins only). */
export const TEMPLATE_SCOPES = ['private', 'shared', 'instance'] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];
export const isTemplateScope = oneOf(TEMPLATE_SCOPES);

export const TEMPLATE_SOURCE_KINDS = ['artifact', 'folder'] as const;
export type TemplateSourceKind = (typeof TEMPLATE_SOURCE_KINDS)[number];

/** Artifact types a template carries. Skills and libraries have marketplace sidecars. */
export const TEMPLATE_ARTIFACT_TYPES: readonly ArtifactType[] = ['html', 'markdown', 'csv', 'json', 'txt', 'pdf', 'image', 'video'];

export const LIMITS = {
  items: 50,
  filesPerItem: 300,
  totalBytes: 25 * 1024 * 1024,
  sampleRows: 5,
  schemaScanRows: 50,
  tags: 10,
  name: 120,
  description: 1000,
  readme: 20_000,
} as const;

export interface TemplateFile {
  path: string;
  mime: string;
  size: number;
  sha256: string;
  /** Text files went through link tokenizing and secret redaction. */
  text: boolean;
}

export interface TemplateTable {
  name: string;
  columns: string[];
  sample_rows?: Record<string, unknown>[];
}

export interface TemplateDataset {
  name: string;
  format: string;
  columns: string[];
  sample_rows?: Record<string, unknown>[];
}

export interface TemplateConnector {
  name: string;
  provider: string;
  kind: string;
  /** artifact: the page's own connector. workspace: a shared workspace connection it uses. */
  scope: 'artifact' | 'workspace';
}

export interface TemplateItem {
  key: string;
  name: string;
  slug: string;
  description: string | null;
  artifact_type: ArtifactType;
  entrypoint: string;
  mobile_entrypoint: string | null;
  folder: string | null;
  files: TemplateFile[];
  source?: ImportedSource;
  config: { comments?: unknown; viewer?: unknown };
  tables: TemplateTable[];
  datasets: TemplateDataset[];
  connectors: TemplateConnector[];
  /** Holds `{{so:id:…}}` tokens: needs a second write once the new artifact ids exist. */
  needs_ids?: boolean;
}

export interface TemplateFolder {
  key: string;
  name: string;
  parent: string | null;
  readme: string | null;
}

export type SetupStep =
  | { kind: 'connector'; name: string; provider: string; items: string[] }
  | { kind: 'table'; name: string; columns: string[]; item: string }
  | { kind: 'dataset'; name: string; columns: string[]; item: string };

export interface TemplateManifest {
  format: 1;
  readme: string | null;
  /** The folder the template was saved from, recreated on install; null for one artifact. */
  root_folder: string | null;
  folders: TemplateFolder[];
  items: TemplateItem[];
  setup: SetupStep[];
}

export type FindingKind = 'email' | 'phone' | 'workspace_name' | 'member' | 'internal_id' | 'secret';

/** Something in the content that looks workspace-specific; shown as a checklist before saving. */
export interface Finding {
  kind: FindingKind;
  item: string | null;
  where: string;
  sample: string;
  count: number;
}

export interface TemplateRow {
  id: string;
  workspace_id: string | null;
  scope: TemplateScope;
  name: string;
  description: string | null;
  tags: string;
  source_kind: TemplateSourceKind;
  source_id: string | null;
  current_version_no: number;
  preview_r2_key: string | null;
  preview_mime: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
