export interface Presentation {
  id: string;
  artifactId: string;
  title: string;
  description: string | null;
  width: number;
  height: number;
  aspectRatio: string;
  template: string | null;
  defaultFonts: { heading: string; body: string; mono: string };
  defaultColors: { background: string; text: string; accent: string };
  defaultTransition: { type: string; duration: number };
  publishedArtifactId: string | null;
  visibility: 'public' | 'private';
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Slide {
  id: string;
  presentationId: string;
  position: number;
  ownerId: string | null;
  overrideBackground: string | null;
  overrideFonts: { heading?: string; body?: string; mono?: string } | null;
  overrideTransition: { type?: string; duration?: number } | null;
  content: string;
  hidden: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Version {
  id: string;
  presentationId: string;
  name: string;
  description: string | null;
  slideCount: number;
  createdById: string | null;
  createdByName: string | null;
  isAutoSave: boolean;
  createdAt: string;
}

export interface PresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  currentSlideIndex: number;
  startedAt: string | null;
}

export interface SlideEvent {
  type:
    | 'slide:added'
    | 'slide:updated'
    | 'slide:deleted'
    | 'slide:reordered'
    | 'presentation:updated'
    | 'presenter:changed';
  data: unknown;
}

