/**
 * Workspace connection API routes — shared connectors for Data Platform providers.
 *
 * Module layout:
 * - `shared` — JSON helper, name validation, member/admin guards, type constants
 * - `credentials` — safe credential summarization and probe credential shaping
 * - `list` — list connectors, catalog view, artifact usage
 * - `crud` — create, read, update, delete, and test connectors
 * - `my-credentials` — per-user credential storage for per_user scope
 * - `oauth` — platform OAuth auth-url/callback and token persistence
 * - `slack` — Slack install, fixed callback, and channel listing
 */
export { summarizeCredentials, buildProbeCredentials } from './credentials';
export {
  GENERIC_TYPES,
  STATIC_AUTH_TYPES,
  CREDENTIAL_SCOPES,
  validateName,
  type CredentialScope,
} from './shared';
export {
  handleListWorkspaceConnections,
  handleWorkspaceConnectorsCatalog,
  handleListConnectionArtifacts,
} from './list';
export {
  handleTestWorkspaceConnection,
  handleGetWorkspaceConnection,
  handleCreateWorkspaceConnection,
  handleDeleteWorkspaceConnection,
  handleUpdateWorkspaceConnection,
} from './crud';
export {
  handleGetMyConnectionCredentials,
  handlePutMyConnectionCredentials,
  handleDeleteMyConnectionCredentials,
} from './my-credentials';
export {
  handleWorkspaceOAuthUrl,
  handleWorkspaceOAuthCallback,
  persistWorkspaceOAuthConnection,
} from './oauth';
export {
  handleSlackInstall,
  handleSlackOAuthCallback,
  handleListSlackChannels,
} from './slack';
