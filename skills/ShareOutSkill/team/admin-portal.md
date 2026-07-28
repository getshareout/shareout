# Workspace Admin Portal

Workspace **owners and admins** manage the workspace from Home → **Admin** lens —
governance, members, automations, support, AI.

Load [SKILL.md](SKILL.md) first.

## Who can access

| Role | Admin lens |
| --- | --- |
| `owner` | Full access to every tab |
| `admin` | Full access to every tab |
| `member` | Admin lens hidden |

## Instance owner (`/admin`) — different thing

`/admin` is the **instance** portal, not the workspace one. Access comes from
`INSTANCE_ADMIN_EMAILS`, `SETUP_ADMIN_EMAIL`, or the roster file. From there an
instance owner acts across every workspace without being a member of any:

| Method | Endpoint | Does |
| --- | --- | --- |
| `POST` | `/v1/admin/workspaces` | Create a workspace: `{name, owner_email, slug?, description?}`. The owner need not have signed in yet. |
| `POST` | `/v1/admin/workspaces/{id}/members` | Set a role: `{email, role}` where role is `owner`/`admin`/`member`. |

Both write to the workspace audit log with the acting admin's email. Use these when
the task is "stand up a workspace for a team and hand it over" — not the
workspace-scoped member endpoints, which require you to already be in it.

## Tabs

| Tab | What you do there |
| --- | --- |
| **Overview** | Artifact/storage totals, views, public exposure, automation health, seat usage if shown — plus **Needs attention** rows (pending invites, inactive members, public artifacts, failing automations) |
| **Artifacts** | Sortable governance table: owner, visibility, views, visitors, size, performance (LCP), paused state — row actions to pause/unpause, change visibility, **transfer ownership** to another workspace member |
| **Members** | Member analytics table (join date, last active, role, agent tokens) — invite, change roles, remove members, manage **pending invites** (resend/revoke), approve/deny **access requests** and **publish approvals** |
| **Sharing** | External sharing — guided **Add client or partner** flow, invite external members, share folders/artifacts at a capability, see read receipts, mint scoped API tokens. See [external-sharing.md](external-sharing.md) |
| **Automation** | Workspace-wide schedules and crew automations as tables — enable/disable, run now, open **Run Inspector** drawer for any run |
| **AI** | Workspace assistant toggles and connector **AI query** settings — which connectors the home agent may query |
| **Security** | Session policy, audit log, workspace Agent tokens (`sot_`) — see [agent-tokens.md](agent-tokens.md) |
| **Settings** | Publish governance policy, workspace branding (logo, accent, footer), **file inbox** address (`{slug}@inbox.example.com`), read-only feature flags |
| **Support** | Customer ticket workbench for this workspace — list, open thread, edit AI draft, **Approve & send** reply on the origin channel, assign, resolve. Super-admins also use the global `/admin?view=support` view for cross-workspace tickets |

Deep-link a tab with hash routing inside Admin: `#l/admin` then pick a tab in the UI.

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

One normalized run detail shape across **crew**, **scheduled job**, and **metric alert** surfaces — steps, tokens, cost, delivery status, errors. Admins open runs from the Automation tab, Brief **Runs** widget, or Needs You failed-run rows.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/runs?surface=&status=&limit=` | List recent runs (`surface`: `crew` \| `job` \| `alert`; `status`: `success` \| `failed`) |
| `GET` | `/v1/workspaces/{id}/runs/{surface}/{runId}` | Full run detail + steps |

Job and alert runs may include a `rerunPath` for **Run again** from the drawer. Crew runs are read-only in the inspector.

## Queues on Members tab

The Members tab surfaces two approval queues without leaving Admin:

- **Access requests** — `GET /v1/access-requests/incoming` (owners) and `POST /v1/access-requests/{id}` with `{ "action": "approve" \| "deny" }`
- **Publish approvals** — `GET /v1/workspaces/{id}/publish-approvals?status=pending` and `POST /v1/artifacts/{id}/publish-approval/{requestId}/decision`

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
- [workspace-context.md](workspace-context.md) — Intelligence tab + REST context files
- [workspace-assistant.md](workspace-assistant.md) — AI tab + home agent
- [activity-feed.md](activity-feed.md) — Needs You rows that link to admin queues
- [../api/jobs.md](../api/jobs.md) — schedule payloads behind job runs
