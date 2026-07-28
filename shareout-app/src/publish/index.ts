/**
 * Artifact publish pipeline — public API.
 *
 * @module publish
 *
 * Entry points:
 * - {@link handlePublish} — token API (POST /v1/publish)
 * - {@link publishGeneratedHtml} — session /create flow
 * - {@link handleCreateLibraryModule} — session library authoring
 * - {@link publishArtifact} — shared core used by all paths + starter kit
 */
export { handlePublish } from './handle-publish';
export { publishGeneratedHtml } from './publish-generated-html';
export { handleCreateLibraryModule } from './library-module';
export { publishArtifact } from './publish-artifact';

// Re-export types for tests and internal consumers
export type { PublishParams, AssetMetadata, AssetPriority, EnhancedManifest } from './types';
export { determinePriority, buildEnhancedManifest } from './manifest';
export { getCacheControl } from './assets';
export { allocateRoutingSlug } from './routing-slug';
export { resolveVisibility, resolveAuthMethod, hashPassword } from './request-auth';
