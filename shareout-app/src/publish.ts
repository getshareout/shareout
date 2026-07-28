/**
 * Backward-compatible re-export — import from `./publish` or `./publish/index`.
 */
export {
  handlePublish,
  publishGeneratedHtml,
  handleCreateLibraryModule,
  publishArtifact,
} from './publish/index';

export type { PublishParams, AssetMetadata, AssetPriority, EnhancedManifest } from './publish/index';
export { determinePriority, buildEnhancedManifest, getCacheControl, allocateRoutingSlug, resolveVisibility, resolveAuthMethod, hashPassword } from './publish/index';
