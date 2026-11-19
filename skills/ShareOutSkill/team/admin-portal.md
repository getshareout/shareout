# Workspace Admin Portal

Workspace **owners and admins** manage the workspace from Home → **Admin** lens —
governance, members, automations, support, AI, billing.

Load [SKILL.md](SKILL.md) first.

## Who can access

| Role | Admin lens |
| --- | --- |
| `owner` | Every page |
| `admin` | Every page except **Summary**, unless the owner lists them under **Who can see this** |
| `member` | Admin lens hidden |

## Instance owner (`/admin`) — different thing

`/admin` is the **instance** portal, not the workspace one. Access comes from
`INSTANCE_ADMIN_EMAILS`, `SETUP_ADMIN_EMAIL`, or the roster file. From there an
instance owner acts across every workspace without being a member of any:

| Method | Endpoint | Does |
| --- | --- | --- |
| `POST` | `/v1/admin/workspaces/provision` | **New customer in one step** — workspace + slug/subdomain + locale, branding, policy and feature flags, starter folders, admin invites, connectors. Idempotent by `slug`; `207` when a step failed. See below. |
| `POST` | `/v1/admin/workspaces` | Create a bare workspace: `{name, owner_email, slug?, description?}`. The owner need not have signed in yet. |
| `POST` | `/v1/admin/workspaces/{id}/members` | Set a role: `{email, role}` where role is `owner`/`admin`/`member`. |

All of them write to the workspace audit log with the acting admin's email. Use these
when the task is "stand up a workspace for a team and hand it over" — not the
workspace-scoped member endpoints, which require you to already be in it.

### Provisioning a customer workspace

Prefer `provision` for any new customer account. Minimal body:

```json
{
  "name": "Acme", "slug": "acme", "locale": "es",
  "admins": ["ana@acme.example.com"],
  "subdomain": true,
  "branding": { "accent_color": "#1a73e8", "logo": { "url": "https://cdn.acme.example.com/logo.png" } },
  "policy": { "allowed_domains": ["acme.example.com"], "external_sharing": true, "guest_comments": false, "knowledge": true, "features": { "ai.crew": false } },
  "folders": ["Clientes", "Proveedores", "Reportes"],
  "connectors": [{ "name": "acme_api", "type": "rest_api", "config": { "base_url": "https://api.acme.example.com" }, "credentials": { "type": "api_key", "data": { "api_key": "<from the operator>" } } }]
}
```

- The first admin owns the workspace. `slug` is required (it is the subdomain) and
  reserved names are refused. A slug held by a differently named workspace is `409
  SLUG_TAKEN` unless `if_exists: "update"`.
- Re-running is the fix for anything: it fills in what is missing, reports the rest
  `unchanged`, never resends a live invite (`resend_invites: true` does), and never
  overwrites a stored connector credential.
- Read `steps[]` (`created` / `updated` / `unchanged` / `skipped` / `pending` /
  `failed`), `admins[]` (`invite_url` appears only when the email did not go out) and
  `next_steps[]`. `custom_domain` attaches the hostname and stays `pending`
  until its DNS records verify, or while custom domains are off on the instance.
- Never put credential values in chat output or files you write; the response never
  echoes them. Operators can use `scripts/provision-workspace.mjs` with a YAML spec and
  `${ENV_VAR}` placeholders for secrets.

## Pages

Admin is a sidebar of pages grouped by topic; it opens on **Members**. Keys are what
`#l/admin/<key>` takes.

| Group | Page (key) | What you do there |
| --- | --- | --- |
| Reports | **Summary** (`summary`) | Month-by-month usage report: active people, page views, publishes, AI questions, reading, pages & knowledge, AI & automations, per member, readers outside the team. Owner, the admins the owner lists (max 50) and platform admins only — hidden for everyone else |
| People | **Members** (`members`) | Member analytics table (join date, last active, role, agent tokens) — **Invite people**, change roles, remove members, manage **pending invites** (resend / copy link / revoke) |
| People | **Sharing** (`clients`) | External sharing — guided **Add client or partner** flow, invite external members, share folders/artifacts at a capability, see read receipts, mint scoped API tokens. See [external-sharing.md](external-sharing.md) |
| People | **Support** (`support`) | Customer ticket workbench for this workspace — list, open thread, edit AI draft, **Approve & send** reply on the origin channel, assign, resolve. Super-admins also use the global `/admin?view=support` view for cross-workspace tickets |
| Content | **Artifacts** (`artifacts`) | Sortable governance table: owner, visibility, views, visitors, size, performance (LCP), paused state — row actions to pause/unpause, change visibility, **transfer ownership** to another workspace member |
| Content | **Automations** (`automation`) | Scheduled jobs, AI task (crew) automations and the connectors they use, as tables — enable/disable, run now, open **Run Inspector** drawer for any run |
| AI & billing | **Billing** (`billing`) | Spend this/last month by category and day (+ CSV), the **monthly AI budget**, AI by kind, today's per-member caps, the **AI report** (+ CSV), **invoices** (download, attach transfer proof → paid) and **billing details**. All amounts at the workspace's price |
| AI & billing | **AI & models** (`ai`) | The workspace's Vercel AI Gateway model, BYO provider key (OpenAI / Vercel Gateway), spend / requests / tokens per model |
| Security | **Access** (`access`) | **Access requests** (approve/deny), membership domain allowlist, session policy |
| Security | **Publishing** (`publishing`) | **Publish approvals** waiting for you, publish governance policy (`allow` / `require_approval` / `prohibit`, `approvals_required`) |
| Security | **Agent tokens** (`tokens`) | Workspace Agent tokens (`sot_`) — see [agent-tokens.md](agent-tokens.md) |
| Security | **Activity log** (`audit`) | Workspace audit log |
| Workspace | **General** (`general`) | Language, whether members can create Team Space folders (`members_can_create_folders`), **file inbox** address (`{slug}@inbox.example.com`), read-only feature flags; instance admins also get a link to `/admin?view=instance` |
| Workspace | **Branding** (`branding`) | Logo, accent color, hide the "Made with ShareOut" footer |
| Workspace | **Custom domain** (`domains`) | Serve the workspace from its own hostname — see [custom-domain.md](custom-domain.md) |

Sidebar badges count what waits: pending invites (Members), access requests (Access),
publish approvals (Publishing), failing automations (Automations), unpaid invoices and a
monthly AI budget near/at its limit (Billing). Billing and Summary routes are in
[api.md](api.md).

Deep-link a page: `#l/admin/<page>` (e.g. `#l/admin/billing`) or `/home?view=admin&tab=<page>`.
Old tab keys still resolve: `overview`/`people` → `members`, `usage` → `billing`,
`security` → `access`, `settings` → `general`. Anything else opens Members.

## Artifact governance API

Workspace admins can list and act on any artifact in the workspace:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/admin/artifacts` | Governance table (owner, visibility, views, size, perf, paused) |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/pause` | `{ "paused": true \| false }` |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/visibility` | `{ "visibility": "private" \| "workspace" \| "public" }` (`unlisted` is a retired legacy alias, still accepted and treated as `public`) |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/transfer` | `{ "email": "member@company.com" }` — new owner must already be a workspace member |

Actions are audit-logged. Transfer keeps the artifact in the workspace; only `owner_id` changes.

## Pending invites

Beyond `POST /v1/workspaces/{id}/members/invite`:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/invites` | List unclaimed invites (expired flag, invited-by) |
| `DELETE` | `/v1/workspaces/{id}/invites/{inviteId}` | Revoke a pending invite |
| `POST` | `/v1/workspaces/{id}/invites/{inviteId}/resend` | Resend invite email |

## Run Inspector

One normalized run detail shape across **crew**, **scheduled job**, and **metric alert** surfaces — steps, tokens, cost, delivery status, errors. Admins open runs from the Automations page, Brief **Runs** widget, or Needs You failed-run rows.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/runs?surface=&status=&limit=` | List recent runs (`surface`: `crew` \| `job` \| `alert`; `status`: `success` \| `failed`) |
| `GET` | `/v1/workspaces/{id}/runs/{surface}/{runId}` | Full run detail + steps |

Job and alert runs may include a `rerunPath` for **Run again** from the drawer. Crew runs are read-only in the inspector.

## Approval queues

Two approval queues live in Admin, each with a sidebar badge while something waits:

- **Access requests** (Admin → **Access**) — `GET /v1/access-requests/incoming` (owners) and `POST /v1/access-requests/{id}` with `{ "action": "approve" \| "deny" }`
- **Publish approvals** (Admin → **Publishing**) — `GET /v1/workspaces/{id}/publish-approvals?status=pending` and `POST /v1/artifacts/{id}/publish-approval/{requestId}/decision`

See [publish-governance.md](publish-governance.md) and [../modules/_shared/permissions.md](../modules/_shared/permissions.md#access-requests-private--workspace-artifacts).

## Support tickets

Workspace owners/admins triage tickets raised by members (or tagged to the workspace) from
Admin → **Support**. Flow: open ticket → review AI draft → edit if needed → **Approve &
send** (delivers on the ticket's origin channel: in-app, email, Slack, Telegram, or
skill API) → mark **resolved** when done.

Agents and apps open tickets via [../api/support.md](../api/support.md). Customers can
also use the in-app **Help & support** widget, email `support@<inbox-domain>`, or the
linked Telegram/Slack bots.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v1/support/tickets?scope=workspace&workspace={id}` | List workspace tickets (admin/owner) |
| `GET` | `/v1/support/tickets/{id}` | Ticket + thread (requester, workspace admin, or super-admin) |
| `POST` | `/v1/support/tickets/{id}/reply` | Staff reply — delivers on origin channel |
| `POST` | `/v1/support/tickets/{id}/status` | `{ "status": "resolved" }` (etc.) |
| `POST` | `/v1/support/tickets/{id}/assign` | `{ "assigneeUserId": "usr_…" }` |
| `POST` | `/v1/support/tickets/{id}/triage` | Re-run AI triage |

## Related

- [../core/workspace-home.md](../core/workspace-home.md#workspace-lenses) — Admin lens entry from Home rail
- [api.md](api.md) — workspace endpoint tables
- [workspace-context.md](workspace-context.md) — REST context files (Knowledge → Guidance)
- [workspace-assistant.md](workspace-assistant.md) — home agent
- [activity-feed.md](activity-feed.md) — Needs You rows that link to admin queues
- [../api/jobs.md](../api/jobs.md) — schedule payloads behind job runs
