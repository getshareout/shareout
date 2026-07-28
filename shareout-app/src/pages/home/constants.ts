/**
 * Static metadata for artifact types, feature badges, and connector tiles.
 */
import type { ArtifactRow } from './types';
import { colors } from '../../design-system/tokens';

export const TYPE_GROUPS: Record<string, string[]> = {
  apps: ['html'],
  data: ['csv', 'json'],
  docs: ['markdown', 'txt', 'pdf'],
  media: ['image', 'video'],
};

export const TYPE_META: Record<string, { label: string; color: string; svg: string }> = {
  html: { label: 'App', color: colors.primary, svg: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' },
  csv: { label: 'Data', color: colors.success, svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 9v12M15 9v12"/>' },
  json: { label: 'JSON', color: colors.warning, svg: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 1 2 2 2 2 0 0 1-2 2v5a2 2 0 0 1-2 2h-1"/>' },
  markdown: { label: 'Doc', color: colors.primaryHover, svg: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15V9l3 3 3-3v6"/><path d="M18 9v6l-2-2"/>' },
  txt: { label: 'Text', color: colors.textTertiary, svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/>' },
  pdf: { label: 'PDF', color: colors.error, svg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>' },
  image: { label: 'Image', color: colors.primary, svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5L9 20"/>' },
  video: { label: 'Video', color: colors.warning, svg: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>' },
};

export const FEATURE_META: Array<{ key: keyof ArtifactRow; label: string; svg: string }> = [
  { key: 'f_blobs', label: 'Files', svg: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>' },
  { key: 'f_datasets', label: 'Datasets', svg: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>' },
  { key: 'f_connections', label: 'Connectors', svg: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>' },
  { key: 'f_platform', label: 'Data platform', svg: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>' },
  { key: 'f_jobs', label: 'Scheduled jobs', svg: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
  { key: 'f_agent', label: 'AI chat', svg: '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/>' },
  { key: 'f_tests', label: 'Tests', svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>' },
  { key: 'f_skills', label: 'Skills', svg: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
];

export const HOME_PAGE_SIZE = 24;
export const HOME_CATALOG_LIMIT = 500;
