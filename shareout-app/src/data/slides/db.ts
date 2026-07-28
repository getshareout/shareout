import type { Presentation, Slide } from './types';
import { normalizeVisibility } from '../../visibility-config';

export interface DbPresentation {
  id: string;
  artifact_id: string;
  title: string;
  description: string | null;
  width: number;
  height: number;
  aspect_ratio: string;
  template: string | null;
  default_fonts: string;
  default_colors: string;
  default_transition: string;
  published_artifact_id: string | null;
  visibility: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbSlide {
  id: string;
  presentation_id: string;
  position: number;
  owner_id: string | null;
  override_background: string | null;
  override_fonts: string | null;
  override_transition: string | null;
  content: string;
  hidden: number;
  locked: number;
  created_at: string;
  updated_at: string;
}

export function mapPresentation(row: DbPresentation): Presentation {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    title: row.title,
    description: row.description,
    width: row.width,
    height: row.height,
    aspectRatio: row.aspect_ratio,
    template: row.template,
    defaultFonts: JSON.parse(row.default_fonts),
    defaultColors: JSON.parse(row.default_colors),
    defaultTransition: JSON.parse(row.default_transition),
    publishedArtifactId: row.published_artifact_id,
    visibility: normalizeVisibility(row.visibility) as 'public' | 'private',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSlide(row: DbSlide): Slide {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    position: row.position,
    ownerId: row.owner_id,
    overrideBackground: row.override_background,
    overrideFonts: row.override_fonts ? JSON.parse(row.override_fonts) : null,
    overrideTransition: row.override_transition ? JSON.parse(row.override_transition) : null,
    content: row.content,
    hidden: row.hidden === 1,
    locked: row.locked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

