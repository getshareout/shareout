# ShareOut Skill Index

Navigation manifest for agents. Load files based on user intent.

**Instance URLs:** every example uses `$ORIGIN` from
`~/.shareout/credentials` → `origin`, or `SHAREOUT_ORIGIN` (see [SKILL.md](SKILL.md)).
There is no public hosted default — resolve origin or deploy first.

## Quick Discovery

| User Intent | Load First | Then If Needed |
|-------------|------------|----------------|
| **Install / deploy / self-host ShareOut on Cloudflare** | [deploy/SKILL.md](deploy/SKILL.md) | [deploy/cloudflare.md](deploy/cloudflare.md), wrangler + cloudflare companion skills |
| Custom domain, DNS, workspace wildcard subdomains | [deploy/cloudflare.md](deploy/cloudflare.md) | [deploy/SKILL.md](deploy/SKILL.md) |
| Create a new artifact from scratch (build/make a page, dashboard, form, tool) | [creating/overview.md](creating/overview.md) | [creating/stack.md](creating/stack.md), [creating/blueprint.md](creating/blueprint.md) |
| Build any artifact (spec/reference) | [SKILL.md](SKILL.md) | [core/html-spec/overview.md](core/html-spec/overview.md) |
| Make an artifact load/render fast (no blank screen) | [patterns/performance.md](patterns/performance.md) | [sdk/overview.md](sdk/overview.md#readiness--loading), [api/jobs.md](api/jobs.md#querysnapshotconfig) |
| Visual editor / live studio | [core/editor.md](core/editor.md) | [core/html-spec/overview.md](core/html-spec/overview.md) |
| Workspace Home / Inspector / Deliver / Edit-Lite / setup checklist / pro search / notifications | [core/workspace-home.md](core/workspace-home.md) | [core/editor.md](core/editor.md), [team/workspace-assistant.md](team/workspace-assistant.md) |
| Edit markdown/json/csv/txt in browser | [core/source-editor.md](core/source-editor.md) | [api/artifact-types.md](api/artifact-types.md) |
| Organize personal artifacts in folders | [api/folders.md](api/folders.md) | [auth.md](auth.md) |
| Find a page/dataset/connector by name (ranked fuzzy search) | [api/search.md](api/search.md) | [api/artifacts.md](api/artifacts.md) |
| Ask a question across workspace pages (⌘K answer mode) | [api/search.md](api/search.md#ask-your-workspace-answer-mode) | [core/workspace-home.md](core/workspace-home.md#pro-search-k) |
| Store/reuse files (assets), folders, visibility, versioned deliverables, send a client a download link | [team/assets.md](team/assets.md) | [sdk/files.md](sdk/files.md) |
| Embed a workspace file across pages (`sdk.files.getUrl`) | [sdk/files.md](sdk/files.md) | [team/assets.md](team/assets.md) |
| Workspace Knowledge / learned library / Guidance | [team/knowledge.md](team/knowledge.md) | [team/workspace-context.md](team/workspace-context.md) |
| Email files to workspace / workspace file inbox / share from phone | [team/assets.md](team/assets.md#add-files-without-opening-assets) | [team/workspace-assistant.md](team/workspace-assistant.md#file-attachments), [team/admin-portal.md](team/admin-portal.md) |
| Build a page from an uploaded/emailed file (assistant) | [team/workspace-assistant.md](team/workspace-assistant.md#file-attachments) | [team/assets.md](team/assets.md) |
| Share folders/artifacts OUTSIDE the team (clients, partners, investors) | [team/external-sharing.md](team/external-sharing.md) | [team/SKILL.md](team/SKILL.md), [team/admin-portal.md](team/admin-portal.md) |
| Scoped external API token (client reads only granted data) | [team/external-sharing.md](team/external-sharing.md#scoped-api-tokens) | [team/agent-tokens.md](team/agent-tokens.md) |
| Private notes ABOUT a client (AI auto-reads + updates) | [team/external-sharing.md](team/external-sharing.md#client-notes-ai-memory-about-a-client) | [team/workspace-assistant.md](team/workspace-assistant.md) |
| Style an artifact / make it on-brand | [modules/ui/overview.md](modules/ui/overview.md) | [modules/ui/classes.md](modules/ui/classes.md), [modules/ui/components.md](modules/ui/components.md) |
| Make it look good / design taste / avoid a generic AI look | [modules/ui/taste.md](modules/ui/taste.md) | [modules/ui/overview.md](modules/ui/overview.md) |
| Dashboard with data | [modules/dashboards/overview.md](modules/dashboards/overview.md) | [sdk/table.md](sdk/table.md), [patterns/dashboards.md](patterns/dashboards.md) |
| Editable spreadsheet grid in an artifact | [sdk/grid.md](sdk/grid.md) | [sdk/table.md](sdk/table.md), [integrations/google-sheets.md](integrations/google-sheets.md) |
| Live Mixpanel / BigQuery / REST in HTML | [sdk/live-data.md](sdk/live-data.md) | [sdk/connections.md](sdk/connections.md), [integrations/overview.md](integrations/overview.md) |
| Show viewers where data comes from / data sources drawer / how to replicate | [patterns/data-provenance.md](patterns/data-provenance.md) | [core/html-spec/manifest.md](core/html-spec/manifest.md#provenance-where-the-data-comes-from), [agents/crew.md](agents/crew.md) |
| Data catalog / governance / lineage / glossary; ground the agent on real tables (catalog_search/catalog_get) | [team/catalog.md](team/catalog.md) | [team/workspace-connections.md](team/workspace-connections.md), [patterns/data-provenance.md](patterns/data-provenance.md) |
| Presentation/slides | [modules/slides/overview.md](modules/slides/overview.md) | [modules/slides/sdk-api.md](modules/slides/sdk-api.md) |
| Deck viewer analytics / tracked links / who opened my deck | [modules/slides/analytics.md](modules/slides/analytics.md) | [modules/slides/sdk-api.md](modules/slides/sdk-api.md) |
| Mobile/PWA app | [modules/mobile/overview.md](modules/mobile/overview.md) | [modules/mobile/pwa.md](modules/mobile/pwa.md) |
| Connect Google Sheets | [integrations/google-sheets.md](integrations/google-sheets.md) | [sdk/overview.md](sdk/overview.md) |
| Connect Google Analytics | [integrations/google-analytics.md](integrations/google-analytics.md) | [patterns/dashboards.md](patterns/dashboards.md) |
| Connect Google Ads / Facebook Ads (BYO token) | [integrations/google-ads.md](integrations/google-ads.md) | [integrations/facebook-ads.md](integrations/facebook-ads.md), [team/workspace-connections.md](team/workspace-connections.md) |
| Public artifact anonymous opt-ins (read-only default) | [modules/_shared/publishing.md](modules/_shared/publishing.md#public-artifacts-read-only-by-default) | [api/artifacts.md](api/artifacts.md#patch-v1artifactsid) |
| Workspace assistant (home chat, threads, daily brief) | [team/workspace-assistant.md](team/workspace-assistant.md) | [team/workspace-connections.md](team/workspace-connections.md), [api/features.md](api/features.md) |
| Workspace admin portal / Run Inspector | [team/admin-portal.md](team/admin-portal.md) | [team/api.md](team/api.md) |
| Home lenses (Datasets, Catalog, Crew, Library, Connectors, Admin, Assets, Knowledge) | [core/workspace-home.md](core/workspace-home.md#workspace-lenses) | [team/SKILL.md](team/SKILL.md#workspace-admin-surfaces) |
| Home activity feed (Needs You + Pulse) | [team/activity-feed.md](team/activity-feed.md) | [core/workspace-home.md](core/workspace-home.md) |
| Home notifications panel (bell, Unread/Seen tabs, dismiss, approvals) | [core/workspace-home.md](core/workspace-home.md#notifications) | [team/api.md](team/api.md#home-activity) |
| Home pro search (⌘K palette, inline quick-jump) | [core/workspace-home.md](core/workspace-home.md#pro-search-k) | [api/search.md](api/search.md) |
| Link multiple Google accounts on Home | [auth.md](auth.md#linked-accounts) | [core/workspace-home.md](core/workspace-home.md) |
| Publish governance (gate public) | [team/publish-governance.md](team/publish-governance.md) | [modules/_shared/publishing.md](modules/_shared/publishing.md), [team/api.md](team/api.md) |
| Skill marketplace (publish, attach skills) | [team/skill-marketplace.md](team/skill-marketplace.md) | [team/workspace-context.md](team/workspace-context.md), [agents/overview.md](agents/overview.md) |
| Official Recommended by ShareOut skills | [team/skill-marketplace.md](team/skill-marketplace.md#official-skills-recommended-by-shareout) | `GET /v1/skills/recommended` |
| Connect Shopify | [integrations/shopify.md](integrations/shopify.md) | [integrations/overview.md](integrations/overview.md) |
| Each viewer sees only their own data | [core/access-policy.md](core/access-policy.md) | [sdk/table.md](sdk/table.md), [modules/_shared/permissions.md](modules/_shared/permissions.md) |
| Multi-tenant / per-customer share | [core/access-policy.md](core/access-policy.md) | [auth.md](auth.md) |
| Save simple state (theme, filters, flags) | [sdk/json.md](sdk/json.md) | [core/html-spec/manifest.md](core/html-spec/manifest.md) |
| Add comments / threaded discussion | [sdk/comments.md](sdk/comments.md) | [modules/_shared/permissions.md](modules/_shared/permissions.md) |
| Comment action items (assign to person, due date) | [sdk/comments.md](sdk/comments.md#action-items) | [team/activity-feed.md](team/activity-feed.md) |
| Real-time collaboration | [sdk/realtime.md](sdk/realtime.md) | [modules/_shared/permissions.md](modules/_shared/permissions.md) |
| File uploads | [sdk/blobs.md](sdk/blobs.md) | [patterns/uploads.md](patterns/uploads.md) |
| AI chat agent | [agents/overview.md](agents/overview.md) | [agents/context.md](agents/context.md) |
| Let viewers operate the page with natural language (GUI agent, click/type/scroll) | [agents/page-pilot.md](agents/page-pilot.md) | [agents/overview.md](agents/overview.md) |
| Artifact crew (refresh → narrate → deliver) | [agents/crew.md](agents/crew.md) | [api/jobs.md](api/jobs.md#querysnapshotconfig), [integrations/slack.md](integrations/slack.md) |
| Chat with pages from Telegram | [agents/telegram.md](agents/telegram.md) | [agents/overview.md](agents/overview.md) |
| Chat with pages from Slack (DM bot) | [agents/slack.md](agents/slack.md) | [agents/telegram.md](agents/telegram.md), [integrations/slack.md](integrations/slack.md) |
| Published HTML sandbox / live data | [sdk/live-data.md](sdk/live-data.md) | [modules/_shared/publishing.md](modules/_shared/publishing.md) |
| Run Python in-browser | [sdk/python.md](sdk/python.md) | [integrations/overview.md](integrations/overview.md) |
| Scheduled notifications | [api/jobs.md](api/jobs.md) | [api/overview.md](api/overview.md) |
| Deterministic warehouse/json snapshot refresh | [api/jobs.md](api/jobs.md#querysnapshotconfig) | [agents/crew.md](agents/crew.md), [sdk/connections.md](sdk/connections.md) |
| Add a safety net / test an artifact won't break on change | [api/tests.md](api/tests.md) | [sdk/table.md](sdk/table.md), [sdk/json.md](sdk/json.md) |
| Alert when a metric/KPI crosses a threshold | [api/metric-alerts.md](api/metric-alerts.md) | [patterns/dashboards.md](patterns/dashboards.md#followable-kpis-metric-alerts) |
| Watch a table metric for sharp moves (bell only) | [api/metric-watch.md](api/metric-watch.md) | [patterns/dashboards.md](patterns/dashboards.md#one-click-metric-watches-simpler) |
| Turn a dashboard into a slides deck (Present this) | [core/workspace-home.md](core/workspace-home.md#present-this-ai-deck) | [api/artifacts.md](api/artifacts.md#present-this-ai-slides-deck) |
| Account analytics (views, visitors, per-viewer breakdown, performance) | [api/artifacts.md](api/artifacts.md#analytics) | [modules/_shared/publishing.md](modules/_shared/publishing.md#monitoring--stats), [core/workspace-home.md](core/workspace-home.md) |
| Follow a number / watch a dashboard value | [api/metric-alerts.md](api/metric-alerts.md) | [api/metric-watch.md](api/metric-watch.md) · [api/jobs.md](api/jobs.md) |
| Slack channel post / DM / snapshot | [integrations/slack.md](integrations/slack.md) | [api/jobs.md](api/jobs.md#slackconfig), [agents/slack.md](agents/slack.md) |
| Connect a workspace to Slack | [integrations/slack.md](integrations/slack.md) | [integrations/overview.md](integrations/overview.md) |
| Workspace administration | [team/SKILL.md](team/SKILL.md) | [team/INDEX.md](team/INDEX.md) |
| Workspace members, roles, invites | [team/api.md](team/api.md#members-and-roles) | [team/SKILL.md](team/SKILL.md#workspace-roles) |
| Internal workspace visibility | [team/SKILL.md](team/SKILL.md#workspace-visibility) | [modules/_shared/permissions.md](modules/_shared/permissions.md) |
| Workspace membership policy | [team/api.md](team/api.md#workspace-membership-policy) | [team/SKILL.md](team/SKILL.md#workspace-membership-policy) |
| Workspace subdomain | [team/subdomain.md](team/subdomain.md) | [deploy/cloudflare.md](deploy/cloudflare.md) |
| Workspace house style/context | [team/workspace-context.md](team/workspace-context.md) | [team/SKILL.md](team/SKILL.md#workspace-context-files) |
| Workspace connectors (shared / per-user tokens) | [team/workspace-connections.md](team/workspace-connections.md) | [team/api.md](team/api.md#workspace-connections) |
| Deliver to multiple destinations | [api/destinations.md](api/destinations.md) | [api/jobs.md](api/jobs.md) |
| Telegram delivery / linked-chat notify | [agents/telegram.md](agents/telegram.md) | [api/jobs.md](api/jobs.md#telegramconfig), [api/metric-alerts.md](api/metric-alerts.md) |
| Discord alerts | [api/jobs.md](api/jobs.md) | [integrations/overview.md](integrations/overview.md) |
| Receive email / forward mail to an artifact / trigger on inbound mail | [integrations/inbound-email.md](integrations/inbound-email.md) | [api/jobs.md](api/jobs.md) |
| Email templates | [sdk/email.md](sdk/email.md#templates) | [api/templates.md](api/templates.md) |
| Raise a support ticket / bug report (agent or app) | [api/support.md](api/support.md) | [api/overview.md](api/overview.md) |
| REST API reference | [api/overview.md](api/overview.md) | [api/artifacts.md](api/artifacts.md) |
| Publish CSV/Markdown/JSON | [api/artifact-types.md](api/artifact-types.md) | [SKILL.md](SKILL.md) |
| Link preview when sharing (Slack, WhatsApp) | [modules/_shared/publishing.md](modules/_shared/publishing.md#link-previews-slack-whatsapp-imessage) | [SKILL.md](SKILL.md#thumbnails) |
| Authentication | [auth.md](auth.md) | [api/overview.md](api/overview.md) |
| Self-serve API token (avatar menu / /v1/me/tokens) | [auth.md](auth.md#self-serve-api-tokens) | [api/overview.md](api/overview.md) |
| Request access to a private page | [modules/_shared/permissions.md](modules/_shared/permissions.md#access-requests-private--workspace-artifacts) | [core/access-policy.md](core/access-policy.md) |
| Hide viewer toolbar on mobile | [api/artifacts.md](api/artifacts.md#viewer-toolbar-shareout-chrome) | [modules/_shared/publishing.md](modules/_shared/publishing.md) |
| Delete an artifact / restore a deleted one / trash & 30-day recovery | [api/artifacts.md](api/artifacts.md#delete--restore-trash) | [api/overview.md](api/overview.md) |
| Check which modules are enabled / handle "feature disabled" | [api/features.md](api/features.md) | [api/errors.md](api/errors.md) |

## File Tree

```
ShareOutSkill/
├── SKILL.md                    # Entry point, use-case router (origin-aware)
├── INDEX.md                    # This file
├── auth.md                     # Token format, credentials, API auth
├── deploy/                     # Install on Cloudflare (agents: start here to self-host)
│   ├── SKILL.md                # Deploy protocol + success criteria
│   └── cloudflare.md           # CF resources, domain/DNS, companion skills
│
├── creating/                   # End-to-end new-artifact build flow (start here to build)
│   ├── overview.md             # The orchestrator: discovery → design → stack → build → QA
│   ├── discovery.md            # Intake questions (why/who/data/destination/design)
│   ├── design-choice.md        # Pick the design language (ShareOut / house style / bespoke)
│   ├── stack.md                # The killer combo (architecture spec, SDK correctness)
│   ├── blueprint.md            # Known-good copy-paste skeletons + archetypes
│   └── pre-ship.md             # Self-QA gate before publish
│
├── team/                       # Workspace admin overlay (load after base skill)
│   ├── SKILL.md                # Workspace entry point (no plan gates on self-host)
│   ├── INDEX.md                # Workspace intent router
│   ├── api.md                  # Workspace REST endpoints
│   ├── subdomain.md            # Workspace subdomain behavior
│   ├── workspace-context.md    # Workspace house-style context files
│   ├── workspace-connections.md  # Shared vs per-user workspace connectors
│   ├── workspace-assistant.md    # Workspace home AI assistant
│   ├── activity-feed.md          # Home Needs You + Pulse, visibility settings
│   ├── publish-governance.md     # Gate open visibility (allow/prohibit/require_approval)
│   ├── skill-marketplace.md      # Per-workspace reusable skill catalog
│   ├── assets.md                 # Asset library — folders, visibility, deliverables, gated links
│   ├── knowledge.md              # Workspace Knowledge — learned library, Guidance, consolidator
│   ├── external-sharing.md       # Share OUTSIDE the team — clients, grants, /shared portal, scoped tokens
│
├── core/                       # Mandatory specs (every artifact)
│   ├── README.md               # Core overview
│   ├── editor.md               # Visual studio at /a/{slug}/edit
│   ├── workspace-home.md       # Home layout, Inspector, Edit-Lite
│   ├── source-editor.md        # Source editor for markdown/json/csv/txt
│   ├── access-policy.md        # Row-level per-viewer data filtering
│   └── html-spec/              # HTML specification v2.0
│       ├── overview.md         # Compliance checklist, why it matters
│       ├── manifest.md         # <script type="shareout/manifest">
│       ├── bindings.md         # data-shareout-binding patterns
│       ├── templates.md        # Repeating content, charts
│       └── pages.md            # Page/section/tab structure
│
├── sdk/                        # SDK method reference
│   ├── overview.md             # Loading, initialization, errors
│   ├── json.md                 # sdk.json - key-value storage
│   ├── table.md                # sdk.table() - structured records
│   ├── grid.md                 # sdk.grid() - editable spreadsheet grid
│   ├── realtime.md             # sdk.realtime() - Y.js collaboration
│   ├── blobs.md                # sdk.blobs - per-artifact file storage
│   ├── files.md                # sdk.files - workspace asset URLs (dlv_*)
│   ├── email.md                # sdk.email - outbound email
│   ├── comments.md             # sdk.comments - threaded discussions
│   ├── python.md               # sdk.python - run Python in the browser
│   ├── connections.md          # sdk.connection - REST + materialize
│   ├── live-data.md            # Mixpanel/BigQuery/live queries in artifacts (READ FIRST)
│   └── datasets.md             # sdk.dataset - read materialized extracts
│
├── api/                        # REST API reference
│   ├── overview.md             # Base URL, auth, rate limits
│   ├── artifacts.md            # /v1/artifacts endpoints
│   ├── artifact-types.md       # CSV, Markdown, JSON, TXT viewers
│   ├── folders.md              # Personal folder CRUD + move artifact
│   ├── blobs.md                # /v1/blobs endpoints
│   ├── jobs.md                 # /v1/jobs endpoints
│   ├── metric-alerts.md        # /v1/metric-alerts — follow a KPI, alert on threshold
│   ├── metric-watch.md         # /v1/metric-watch — one-click table watches, bell alerts
│   ├── search.md               # GET /v1/search + POST /v1/ask answer mode
│   ├── destinations.md         # Delivery layer (slack/email/discord/webhook)
│   ├── templates.md            # /v1/templates endpoints
│   ├── webhooks.md             # Webhook payloads
│   └── errors.md               # Error codes
│
├── integrations/               # External services
│   ├── overview.md             # Data Platform intro
│   ├── slack.md                # Slack connection, channel/DM delivery
│   ├── google-sheets.md        # Google Sheets OAuth + API
│   ├── google-analytics.md     # GA4 integration
│   ├── google-ads.md           # Google Ads token-shim connector
│   ├── facebook-ads.md         # Facebook Ads token-shim connector
│   ├── shopify.md              # Shopify proxy
│   ├── tiendanube.md           # Tienda Nube proxy
│   ├── cors-proxy.md           # Generic CORS proxy
│   └── github.md               # GitHub backup/export
│
├── agents/                     # AI agent integration
│   ├── overview.md             # In-artifact visitor chat (sdk.agent)
│   ├── page-pilot.md           # Page Pilot — GUI agent (click/type/scroll on viewer's behalf)
│   ├── crew.md                 # Artifact crew tools (query, materialize, deliver)
│   ├── telegram.md             # Account-level Telegram bot
│   ├── slack.md                # Account-level Slack DM bot
│   ├── context.md              # Context injection
│   └── prompts.md              # System prompt patterns
│
├── modules/                    # Product modules
│   ├── ui/                     # Design system for artifacts
│   │   ├── overview.md         # Load shareout.css, rules, tokens
│   │   ├── taste.md            # Design taste — look designed, not AI-generated
│   │   ├── classes.md          # .so- class reference
│   │   └── components.md       # ShareOutUI JS API (toast, modal, tabs)
│   │
│   ├── _shared/                # Common patterns (DRY)
│   │   ├── permissions.md      # Role model, collaborators
│   │   ├── versions.md         # History, snapshots
│   │   └── publishing.md       # Edit vs published mode, link previews (OG)
│   │
│   ├── slides/                 # Presentation module
│   │   ├── overview.md         # Entry, quick start
│   │   ├── sdk-api.md          # Slide SDK methods
│   │   ├── analytics.md        # Viewer analytics, tracked links, open alerts
│   │   ├── presenter.md        # Presenter mode
│   │   ├── data-model.md       # Y.js structure
│   │   └── design/             # Visual guidelines
│   │
│   ├── dashboards/             # Dashboard module
│   │   ├── overview.md         # Entry, quick start
│   │   ├── sdk-api.md          # Dashboard SDK methods
│   │   ├── widgets.md          # Widget reference
│   │   ├── data-model.md       # Y.js structure
│   │   └── design/             # Visual guidelines
│   │
│   └── mobile/                 # Mobile/PWA module
│       ├── overview.md         # Entry, quick start
│       ├── sdk-api.md          # Mobile SDK methods
│       ├── pwa.md              # PWA features
│       └── design/             # Visual guidelines
│
└── patterns/                   # Copy-paste starters
    ├── overview.md             # Pattern index
    ├── forms.md                # Form patterns
    ├── tables.md               # Data table patterns
    ├── dashboards.md           # Dashboard patterns
    ├── uploads.md              # File upload patterns
    ├── data-provenance.md      # "Where does this data come from?" drawer + badges
    └── performance.md          # Instant first paint, no blank screen
```

## Loading Guidance

Quick Discovery above maps any single intent to its files. Two flows need a specific load *order*:

### Building a New Artifact (start here)
1. [creating/overview.md](creating/overview.md) → The end-to-end flow
2. [creating/discovery.md](creating/discovery.md) → Ask before building
3. [creating/design-choice.md](creating/design-choice.md) + [creating/stack.md](creating/stack.md) → Lock the look and the architecture
4. [creating/blueprint.md](creating/blueprint.md) → Start from a known-good skeleton
5. [creating/pre-ship.md](creating/pre-ship.md) → Self-QA gate before publish

### Install / Deploy (self-host)
1. [deploy/SKILL.md](deploy/SKILL.md) → Path 0 if no Cloudflare account, then Path A/B
2. Run `npm run deploy` (never bare `wrangler deploy` on placeholders)
3. Load companion skills: wrangler, cloudflare, workers-best-practices, durable-objects
4. [deploy/cloudflare.md](deploy/cloudflare.md) → D1/R2/KV/DO, domain, email
5. Smoke + credentials with `origin` → then return to [SKILL.md](SKILL.md) for product work

### Workspace admin work
1. [SKILL.md](SKILL.md) → Base rules + `$ORIGIN`
2. [team/SKILL.md](team/SKILL.md) → Workspace roles and admin surfaces
3. [team/INDEX.md](team/INDEX.md) → Workspace file router
4. If workspace is known, fetch `GET $ORIGIN/v1/skill?workspace=<slugOrId>` with a Bearer token for house-style context

## Domain Boundaries

| Domain | Scope | Key Files |
|--------|-------|-----------|
| **Deploy** | Self-host install, Cloudflare, domain/DNS | `deploy/` |
| **Creating** | Guided end-to-end new-artifact build flow | `creating/` |
| **Core** | HTML spec, publishing, artifact types, access policy | `core/`, `auth.md`, `api/artifact-types.md` |
| **Workspace / team** | Workspace admin, members, subdomain, context (unlocked on self-host) | `team/` |
| **SDK** | Client-side methods, templates | `sdk/` |
| **API** | REST endpoints | `api/` |
| **Integrations** | External services | `integrations/` |
| **Agents** | AI chat features | `agents/` |
| **Modules** | Product types | `modules/slides/`, `modules/dashboards/`, `modules/mobile/` |
| **Patterns** | Code starters | `patterns/` |

## File Size Targets

- Entry point: ~250 lines
- Overview files: 150-250 lines
- Reference files: 200-400 lines
- Maximum any file: 500 lines
