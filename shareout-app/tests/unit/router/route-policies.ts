// Routes that answer an anonymous caller on purpose, keyed by the matcher text exactly as
// it appears in router source (see route-matchers.ts). route-auth-policy.test.ts requires
// every other route to refuse anonymous callers, so adding a route here is a decision:
// say why it is open, and what gates it instead if anything.

const PUBLIC = 'public by design: no tenant data';
const SIGN_IN = 'sign-in / sign-up flow: anonymous by definition';
const SIGNED = 'webhook: authenticated by a shared secret or signature, not a session';
const CONTENT = 'artifact content: access is decided per artifact (visibility, grants, password, content token); unknown ids are 404';
const PREFIX = 'dispatch prefix: the routes under it are checked one by one';
const OAUTH = 'OAuth / connector callback: state is signed and bound to the signed-in user';

export const OPEN_ROUTES: Record<string, string> = {
  '/connect-consent': 'connector consent page: renders nothing without a session (sign-in redirect, 400 without params); POST needs a session and a same-origin request',
  // Discovery, docs and static assets
  '/.well-known/agent-skills/index.json': PUBLIC,
  '/.well-known/agent-skills/shareout/SKILL.md': PUBLIC,
  '/.well-known/integrations.json': PUBLIC,
  '/.well-known/oauth-authorization-server': PUBLIC,
  '/.well-known/oauth-protected-resource': PUBLIC,
  '/.well-known/oauth-protected-resource/mcp': PUBLIC,
  '/openapi.json': PUBLIC,
  '/openapi.agent.json': PUBLIC,
  '/llms.txt': PUBLIC,
  '/robots.txt': PUBLIC,
  '/sitemap.xml': PUBLIC,
  '/sitemap-product.xml': PUBLIC,
  '/manifest.webmanifest': PUBLIC,
  '/sw.js': PUBLIC,
  '/health': PUBLIC,
  '/status': PUBLIC,
  '/status/': PUBLIC,
  '/privacy': PUBLIC,
  '/privacy/': PUBLIC,
  '/terms': PUBLIC,
  '/terms/': PUBLIC,
  '/teams/preview': PUBLIC,
  '/teams/preview/': PUBLIC,
  '/workspace': 'workspace picker page; redirects to the subdomain, which gates itself',
  '/workspace/': 'workspace picker page; redirects to the subdomain, which gates itself',
  [String.raw`^\/workspace\/([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])\/?$`]: 'redirect to the workspace subdomain, which gates itself',
  '/share-target': 'PWA share target; redirects to /home, which gates itself',
  '/settings/api-token': 'legacy URL; redirects to /home, which gates itself',
  '/settings/tokens': 'legacy URL; redirects to /home, which gates itself',
  '/setup': 'first-run setup page; only acts while the instance has no admin',
  '/setup/': 'first-run setup page; only acts while the instance has no admin',
  '/__debug/request': 'echoes the caller\'s own request headers only',
  '/sdk/chat-core.js': PUBLIC,
  '/sdk/comments-agent.js': PUBLIC,
  '/sdk/editor.js': PUBLIC,
  '/sdk/page-pilot.js': PUBLIC,
  '/lib/': PUBLIC,
  '/vendor/': 'public npm packages vendored by allowlist',
  '/v1/skill': PUBLIC,
  '/v1/skill/meta': PUBLIC,
  '/v1/skill/version': PUBLIC,
  [String.raw`^\/v1\/skill\/(.+)$`]: PUBLIC,
  '/v1/skills/install.sh': PUBLIC,
  [String.raw`^\/v1\/skills\/([^/]+)\/raw$`]: 'published skill body; served per the skill artifact\'s own visibility',
  [String.raw`^\/v1\/artifacts\/([^/]+)\/lib\/([^/]+)$`]: 'published library module; served per the library artifact\'s own visibility',
  '/invite/': 'invite landing page; the token in the URL is the credential',
  '/report/': 'public abuse report form; accepted only for public artifacts',
  '/v1/email/unsubscribe': 'one-click unsubscribe; the signed token in the URL is the credential',

  // Sign-in and sign-up
  '/auth/login': SIGN_IN,
  '/auth/logout': SIGN_IN,
  '/auth/callback': SIGN_IN,
  '/auth/google': SIGN_IN,
  '/auth/google/onetap': SIGN_IN,
  '/auth/sso': SIGN_IN,
  '/auth/sso/callback': SIGN_IN,
  '/auth/microsoft': SIGN_IN,
  '/auth/microsoft/callback': SIGN_IN,
  '/shared/guest/': 'space-guest sign-in (no account): emailed code or signed invite link; sessions are signed and re-checked against the live grant',
  '/auth/dev': 'local development sign-in; refused off localhost',
  '/auth/device': SIGN_IN,
  '/auth/device/done': SIGN_IN,
  '/auth/password': 'artifact password gate',
  '/auth/credentials': 'artifact credentials gate',
  '/v1/auth/session': 'reports whether the caller is signed in',
  '/v1/auth/sso/lookup': SIGN_IN,
  '/v1/auth/email/start': SIGN_IN,
  '/v1/auth/email/verify': SIGN_IN,
  '/v1/auth/device/start': SIGN_IN,
  '/v1/auth/device/token': SIGN_IN,
  '/v1/auth/password/register': SIGN_IN,
  '/v1/auth/password/login': SIGN_IN,
  '/v1/auth/password/reset': SIGN_IN,
  '/oauth/authorize': 'MCP OAuth authorize; consent requires a session',
  '/oauth/register': 'MCP OAuth dynamic client registration (RFC 7591)',
  '/oauth/token': 'MCP OAuth token endpoint; authenticated by code + PKCE or refresh token',
  '/oauth/revoke': 'MCP OAuth revocation endpoint (RFC 7009)',

  // Webhooks
  '/slack/events': SIGNED,
  '/slack/commands': SIGNED,
  '/slack/interactions': SIGNED,
  '/telegram/webhook': SIGNED,
  '/v1/webhooks/email-events': SIGNED,

  // Connector OAuth callbacks
  '/v1/oauth/slack/callback': OAUTH,
  '/v1/oauth/mcp/callback': OAUTH,
  '/oauth/mcp-client.json': 'OAuth client metadata document for MCP connectors; public by design',
  [String.raw`^\/v1\/workspaces\/([^/]+)\/connections\/([^/]+)\/callback$`]: OAUTH,
  [String.raw`^\/v1\/file-imports\/oauth\/([^/]+)\/callback$`]: OAUTH,

  // Artifact and file content
  '/a/': CONTENT,
  '/@': CONTENT,
  '/p/': CONTENT,
  '/d/': CONTENT,
  '/embed/': CONTENT,
  [String.raw`^\/a\/([^/]+)\/?(.*)$`]: CONTENT,
  [String.raw`^\/a\/([^/]+)\/_text$`]: CONTENT,
  [String.raw`^\/a\/([^/]+)\/admin$`]: CONTENT,
  [String.raw`^\/@([^/]+)\/(.+)$`]: CONTENT,
  [String.raw`^\/p\/([^/]+)\/?(.*)$`]: CONTENT,
  [String.raw`^\/d\/([^/]+)\/?$`]: CONTENT,
  [String.raw`^\/d\/([^/]+)\/file\/([^/]+)\/?$`]: CONTENT,
  [String.raw`^\/embed\/([^/]+)\/?(.*)$`]: CONTENT,
  [String.raw`^\/t\/([^.]+)\.(webp|png|jpg)$`]: CONTENT,
  [String.raw`^\/wl\/([^.]+)\.(webp|png|jpg|svg)$`]: 'workspace logo; public by design',
  [String.raw`^\/v1\/files\/([^/]+)$`]: CONTENT,
  [String.raw`^\/v1\/files\/([^/]+)\/content$`]: CONTENT,
  '/v1/data/': 'artifact data API: data middleware decides per artifact and tier',
  [String.raw`^\/v1\/artifact-templates\/(tpl_[a-f0-9]+)\/view\/([0-9]+\.[A-Za-z0-9_-]+)\/([a-z0-9]+)\/(.*)$`]: 'template preview: the signed, short-lived path segment is the credential; served sandboxed',

  // Dispatch prefixes
  '/v1/': PREFIX,
  '/v1/home/': PREFIX,
  '/v1/email/': PREFIX,
  '/v1/support/': PREFIX,
  '/slack/': PREFIX,
  '/telegram/': PREFIX,
  '/oauth/': PREFIX,
};

// Routers that read `user.service` and bound workspace Agent tokens to their workspace
// and scopes. Every other router uses the default guards, which refuse those tokens.
export const AGENT_TOKEN_ROUTERS: string[] = [
  'src/router/api/artifacts.ts',
  'src/router/api/support.ts',
  'src/router/handle-fetch.ts',
];

// How each MCP tool is scoped. `workspace`: acts only in a workspace the caller is an
// internal member of. `artifact`: acts only on an artifact the caller can access with
// the role the action needs. `self`: reads or writes only the caller's own account.
export type McpToolPolicy = 'workspace' | 'artifact' | 'self';

export const MCP_TOOL_POLICIES: Record<string, McpToolPolicy> = {
  whoami: 'self',
  list_workspaces: 'self',
  get_help: 'self',
  report_problem: 'self',
  search: 'self',
  list_artifacts: 'workspace',
  publish_artifact: 'workspace',
  list_members: 'workspace',
  invite_members: 'workspace',
  resend_invite: 'workspace',
  revoke_invite: 'workspace',
  folder_access: 'workspace',
  folder_activity: 'workspace',
  share_with_person: 'workspace',
  revoke_share: 'workspace',
  set_guest_comments: 'workspace',
  knowledge_search: 'workspace',
  knowledge_get: 'workspace',
  knowledge_entity: 'workspace',
  knowledge_facts: 'workspace',
  knowledge_status: 'workspace',
  knowledge_reindex: 'workspace',
  list_connections: 'workspace',
  query_connection: 'workspace',
  browse_storage: 'workspace',
  get_artifact: 'artifact',
  update_artifact: 'artifact',
  fetch: 'artifact',
  list_versions: 'artifact',
  get_version_source: 'artifact',
  restore_version: 'artifact',
  list_comments: 'artifact',
  resolve_comment: 'artifact',
  assign_comment: 'artifact',
  approve_version: 'artifact',
  list_jobs: 'artifact',
  knowledge_from_artifact: 'artifact',
  list_templates: 'workspace',
  install_template: 'workspace',
  save_as_template: 'artifact',
};
