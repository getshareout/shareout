/**
 * Artifact domain — REST handlers for `/v1/artifacts` and related routes.
 *
 * Module layout:
 * - `roles` — ownership and collaborator access checks
 * - `crud` — list, read, update, delete, purge
 * - `favorites` — per-user bookmarks
 * - `tags` — organizational labels
 * - `collaborators` — sharing access with other users
 * - `share` — email share flow
 * - `versions` — version history and rollback
 * - `files` — read published source from R2
 * - `types` — shared response shapes
 */
export { getUserRole } from './roles';
export type {
  ArtifactSummary,
  ArtifactDetail,
  ArtifactFile,
  ArtifactFilesResponse,
} from './types';
export {
  handleListArtifacts,
  handleGetArtifact,
  handleUpdateArtifact,
  handleDeleteArtifact,
  handleListDeletedArtifacts,
  handleRestoreArtifact,
  handleRestoreAllDeleted,
  purgeArtifact,
  softDeleteArtifact,
  purgeSoftDeleted,
  RETENTION_DAYS,
} from './crud';
export { handleAddFavorite, handleRemoveFavorite } from './favorites';
export { handleGetTags, handleAddTag, handleRemoveTag } from './tags';
export {
  addCollaboratorEmails,
  handleGetCollaborators,
  handleAddCollaborators,
  handleRemoveCollaborator,
  handleTransferOwnership,
} from './collaborators';
export { handleShareArtifact } from './share';
export { handleGetVersions, handleRollback } from './versions';
export { handleGetArtifactFiles } from './files';
