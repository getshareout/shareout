// Feature-flag registry — the single source of truth for every product feature
// that can be toggled per workspace (and platform-wide). Shipping a new feature
// behind a flag is one entry here plus one `isFeatureEnabled` check at its entry
// point. Keys are a stable contract: persisted in workspace.feature_flags and
// platform_config, so never rename one without a data migration.

export type FeatureCategory =
  | 'ai'
  | 'automation'
  | 'destinations'
  | 'integrations'
  | 'collaboration'
  | 'modules';

export interface FeatureDef {
  /** Stable, dotted key. Persisted — do not rename without migrating data. */
  key: string;
  label: string;
  description: string;
  category: FeatureCategory;
  /** Effective value when no workspace or global override exists. */
  defaultEnabled: boolean;
}

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  ai: 'AI',
  automation: 'Automation',
  destinations: 'Delivery destinations',
  integrations: 'Integrations',
  collaboration: 'Collaboration',
  modules: 'Modules',
};

export const FEATURES: FeatureDef[] = [
  // --- AI ---
  { key: 'ai.crew', label: 'CrewAI agents', description: 'Multi-step AI agents with tools, triggers and approvals.', category: 'ai', defaultEnabled: true },
  { key: 'ai.visitor_chat', label: 'In-artifact AI chat', description: 'Visitor-facing AI assistant embedded in artifacts.', category: 'ai', defaultEnabled: true },
  { key: 'ai.editor_chat', label: 'Editor AI assistant', description: 'AI help inside the visual editor (generate/edit/publish).', category: 'ai', defaultEnabled: true },
  { key: 'ai.telegram_bot', label: 'Telegram bot', description: 'Account-level Telegram chat agent.', category: 'ai', defaultEnabled: true },
  { key: 'ai.slack_bot', label: 'Slack bot', description: 'Account-level Slack DM chat agent.', category: 'ai', defaultEnabled: false },
  { key: 'ai.create', label: 'AI Creator (/create)', description: 'Chat-first artifact builder at /create (plan, preview, publish).', category: 'ai', defaultEnabled: false },
  { key: 'ai.web_agent', label: 'Workspace home assistant', description: 'Workspace-scoped AI assistant on the home page (concierge + read-only data). On by default; turn it off per workspace under Admin → Features.', category: 'ai', defaultEnabled: true },

  // --- Automation ---
  { key: 'automation.scheduled_jobs', label: 'Schedules & crons', description: 'Scheduled artifact jobs (cron-triggered delivery).', category: 'automation', defaultEnabled: true },
  { key: 'automation.event_triggers', label: 'Event triggers', description: 'Event-driven jobs (artifact updated/viewed, comment added).', category: 'automation', defaultEnabled: true },
  { key: 'automation.notifications', label: 'Alerts & notifications', description: 'Viewer subscriptions and scheduled notifications.', category: 'automation', defaultEnabled: true },

  // --- Delivery destinations (1:1 with delivery job `action`/`kind`) ---
  { key: 'dest.slack', label: 'Slack', description: 'Deliver to Slack channels or DMs.', category: 'destinations', defaultEnabled: true },
  { key: 'dest.discord', label: 'Discord', description: 'Deliver to Discord via webhook.', category: 'destinations', defaultEnabled: true },
  { key: 'dest.webhook', label: 'Webhook', description: 'POST artifact data to a custom HTTP endpoint.', category: 'destinations', defaultEnabled: true },
  { key: 'dest.email', label: 'Email', description: 'Send templated emails with artifact data.', category: 'destinations', defaultEnabled: true },
  { key: 'dest.http_get', label: 'HTTP GET', description: 'Trigger a simple HTTP GET request.', category: 'destinations', defaultEnabled: true },
  { key: 'dest.materialize', label: 'Materialize', description: 'Persist artifact data to a warehouse table.', category: 'destinations', defaultEnabled: true },

  // --- Integrations ---
  { key: 'integ.data_platform', label: 'Data Platform', description: 'External connectors: Sheets, GA, Shopify, Snowflake, BigQuery, Postgres.', category: 'integrations', defaultEnabled: true },
  { key: 'integ.connections', label: 'Workspace connections', description: 'Shared workspace-level credentials for integrations.', category: 'integrations', defaultEnabled: true },
  { key: 'integ.github', label: 'GitHub export', description: 'Export/sync artifacts to GitHub repos.', category: 'integrations', defaultEnabled: true },
  { key: 'integ.cors_proxy', label: 'CORS proxy', description: 'Proxy external API requests from artifacts.', category: 'integrations', defaultEnabled: true },

  // --- Collaboration ---
  { key: 'collab.realtime', label: 'Realtime collaboration', description: 'Live multi-user editing (Y.js/WebSocket).', category: 'collaboration', defaultEnabled: true },
  { key: 'collab.comments', label: 'Comments', description: 'Threaded in-artifact comments.', category: 'collaboration', defaultEnabled: true },

  // --- Modules ---
  { key: 'module.visual_editor', label: 'Live Studio (visual editor)', description: 'Chat-first WYSIWYG editor at /a/{slug}/edit for HTML artifacts.', category: 'modules', defaultEnabled: true },
  { key: 'module.slides', label: 'Slides', description: 'Slide decks / presentations backend.', category: 'modules', defaultEnabled: true },
  { key: 'module.python', label: 'Python (Pyodide)', description: 'In-browser Python execution.', category: 'modules', defaultEnabled: true },
  { key: 'module.blobs', label: 'File storage (blobs)', description: 'Binary file uploads attached to artifacts.', category: 'modules', defaultEnabled: true },
  { key: 'module.email_templates', label: 'Email templates', description: 'Reusable email templates with variables.', category: 'modules', defaultEnabled: true },
];

export const FEATURE_KEYS = new Set(FEATURES.map((f) => f.key));

export function isKnownFeature(key: string): boolean {
  return FEATURE_KEYS.has(key);
}

export function featureDefault(key: string): boolean {
  const f = FEATURES.find((x) => x.key === key);
  // Unknown keys fail open: a stale check never blocks a real feature.
  return f ? f.defaultEnabled : true;
}
