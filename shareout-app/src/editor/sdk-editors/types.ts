import type { Env } from '../../types';
import type { DetectedComponent } from '../types';

export interface SDKEditorContext {
  artifactId: string;
  userId: string;
  /** Caller's access level on this artifact; gates owner-only mutations. */
  role: 'owner' | 'editor' | 'viewer';
  env: Env;
  component: DetectedComponent;
}

export type SDKEditorHandler = (
  request: Request,
  ctx: SDKEditorContext,
  action: string
) => Promise<Response>;

export type ActionHandler = () => Promise<Response>;
