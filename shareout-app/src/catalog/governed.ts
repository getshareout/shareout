import type { Env } from '../types';
import { parseCatalog } from './parse';
import { listCatalogFiles, type StoredCatalogFile } from './store';
import { aliasIndex, withGraphLineage } from './lineage';
import { certificationHash, groupDecisions, listCertifications, resolveCertification } from './certification';
import type { CatalogEntry, CertificationRecord, ParseIssue } from './types';

export interface GovernedCatalog {
  /** Entries with their effective `status`, `certification` overlay and graph lineage. */
  entries: CatalogEntry[];
  issues: ParseIssue[];
  /** Each entry's decisions, oldest first, keyed by its current id. */
  decisions: Map<string, CertificationRecord[]>;
  /** The stored file behind each entry, by path. */
  files: Map<string, StoredCatalogFile>;
}

/**
 * The catalog as everyone reads it — REST, lens, agent tools: parsed files, each entry's
 * status taken from owner/admin decisions on its current version (never from the file's
 * `status` line alone), and lineage counted from both ends of every edge.
 */
export async function loadGovernedCatalog(env: Env, workspaceId: string): Promise<GovernedCatalog> {
  const [stored, records] = await Promise.all([
    listCatalogFiles(env, workspaceId),
    listCertifications(env, workspaceId),
  ]);
  const { entries, issues } = parseCatalog(stored);
  const files = new Map(stored.map(f => [f.path, f]));
  const hashes = await Promise.all(entries.map(e => certificationHash(e.kind, files.get(e.path)?.content ?? '')));
  const decisions = groupDecisions(records, aliasIndex(entries));
  const governed = withGraphLineage(entries).map((e, i) => {
    const certification = resolveCertification(e.status, hashes[i], decisions.get(e.id) ?? []);
    return { ...e, status: certification.status, certification };
  });
  return { entries: governed, issues, decisions, files };
}
