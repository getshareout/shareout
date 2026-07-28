import type { ArtifactType, TypeMetadata } from '../types';
import type { ViewerContext } from './viewer-shell';
import type { SocialPreview } from '../serve/social-meta';
import { renderTxtViewer } from './txt-viewer';
import { renderJsonViewer } from './json-viewer';
import { renderMarkdownViewer } from './markdown-viewer';
import { renderCsvViewer } from './csv-viewer';
import { renderSkillViewer } from './skill-viewer';
import { renderLibraryViewer } from './library-viewer';

export type { ViewerContext } from './viewer-shell';

type ViewerRenderer = (ctx: ViewerContext) => string;

const viewers: Partial<Record<ArtifactType, ViewerRenderer>> = {
  txt: renderTxtViewer,
  json: renderJsonViewer,
  markdown: renderMarkdownViewer,
  csv: renderCsvViewer,
  skill: renderSkillViewer,
  library: renderLibraryViewer,
};

function getViewer(type: ArtifactType): ViewerRenderer | null {
  return viewers[type] || null;
}

export function hasCustomViewer(type: ArtifactType): boolean {
  return type in viewers;
}

export function renderViewer(
  type: ArtifactType,
  slug: string,
  artifactName: string,
  typeMetadata: TypeMetadata,
  baseUrl: string,
  content: string,
  isAdmin: boolean,
  artifactId: string,
  loggedIn: boolean,
  isFavorite: boolean,
  socialPreview?: SocialPreview,
  skillMetrics?: ViewerContext['skillMetrics'],
  libraryMetrics?: ViewerContext['libraryMetrics'],
): string | null {
  const renderer = getViewer(type);
  if (!renderer) return null;

  const ctx: ViewerContext = {
    slug,
    artifactName,
    artifactType: type,
    typeMetadata,
    baseUrl,
    content,
    isAdmin,
    artifactId,
    loggedIn,
    isFavorite,
    socialPreview,
    skillMetrics,
    libraryMetrics,
  };

  return renderer(ctx);
}
