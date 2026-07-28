# External Sharing (Clients & Partners)

Share folders and artifacts **outside the workspace** — with a client, supplier, partner, or investor — without making them workspace members. The outside org sees only what you grant, on a branded portal, and you see when they open it.

Load [SKILL.md](SKILL.md) first. External sharing is a **Teams / Enterprise** feature.

## Model

| Term | Means |
| --- | --- |
| **Client** (a.k.a. external org) | A typed outside org you share with — `client`, `supplier`, `partner`, `investor`, or any free string. The UI labels these by type ("Clients", "Partners"); never call it a "Sharee" to users. |
| **External member** | A person on a Client. Has a real ShareOut login but is an **external** membership edge — excluded from seats and from every internal member listing. **Free, unlimited.** |
| **Grant** | A capability (`view`, `comment`, `create`, `edit`) on a **folder**, **artifact**, or **file**, given to a whole Client or one external user. A folder grant inherits to everything inside it (pages **and** files). |
| **Portal** | `/shared` — the external member's "shared with me" page; only granted pages and downloadable files, branded by the Client. First-time visitors see a short orientation card. **Comment** grants on files open a per-file comment thread on the portal — the workspace team sees replies in Needs You. |

**The paid boundary is the feature, not a head count.** External members never inflate the bill; Teams/Enterprise unlocks the formal system (Client orgs, folder grants, branding, scoped tokens, receipts). Creating a Client / member / grant / token requires the entitlement → otherwise `403 EXTERNAL_SHARING_NOT_ENTITLED`. Read access for already-granted externals keeps working even if the plan lapses (no dark-screening a live client deliverable).

This sits **above** the free base sharing (N external emails on one artifact via collaborators + email-OTP), which stays uncapped. Grow into Clients when you want grouping, a portal, scoped API, and receipts.

## Manage from the app

Home → **Admin** lens → **Sharing** tab (owners/admins only). The tab was renamed from "Clients" — the UI label is **Sharing**; the underlying org is still a **Client** (client, supplier, partner, investor).

**How it works:**

1. **Create a client.** **Add client or partner** — an inline form on the page (company name + relationship). No modal; the empty state walks through the steps and the same form appears under the header once you have clients.
2. **Invite their people.** Add emails — they get an invite and log in like any ShareOut user. They stay external (never on your member list, never billed).
3. **Share a folder or file.** Pick a folder and a level — **View**, **Comment**, **Can create**, or **Can edit**. A folder shares everything inside it — **pages and files**.
4. **They open `/shared`.** Each external person has a "shared with you" page showing only what you gave them — pages and downloadable files — branded by their client org when grouped under a client.

From there: see recent activity and mint API tokens — no API needed.

**Share with a person (quick path):** from Assets, **Share with a person** on a file tile sends one outside email view/comment access without creating a Client org. Same capability via `POST …/share-person` (admin + Teams entitlement).

## Share with one person (API)

```http
POST /v1/workspaces/{wid}/share-person
Authorization: Bearer {token}
Content-Type: application/json

{
  "email": "client@acme.com",
  "resource_type": "file",
  "resource_id": "dlv_…",
  "capability": "view"
}
```

`resource_type` may be `"file"` or `"folder"`. `capability` is `view` or `comment`. Invites the external user if needed; the resource appears on their `/shared` portal. Returns `409 ALREADY_MEMBER` if the email is already an internal workspace member.

## API

All management endpoints require workspace `admin` + the entitlement.

### Clients

| Method | Endpoint | Body / notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{wid}/sharees` | List Clients (with `member_count`). |
| `POST` | `/v1/workspaces/{wid}/sharees` | `{ "name": "Acme", "type": "client" }` |
| `GET` | `/v1/workspaces/{wid}/sharees/{sid}` | One Client. |
| `PATCH` | `/v1/workspaces/{wid}/sharees/{sid}` | `{ name?, type?, properties?, branding? }` — `branding` is `{ logo, color }` for the portal. |
| `DELETE` | `/v1/workspaces/{wid}/sharees/{sid}` | Removes the Client + its members + its grants. |

### Members

| Method | Endpoint | Body / notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{wid}/sharees/{sid}/members` | List external members. |
| `POST` | `/v1/workspaces/{wid}/sharees/{sid}/members` | `{ "email": "ext@acme.com" }` — pre-creates the user, sends an invite, stamps an **external** membership edge. |
| `DELETE` | `/v1/workspaces/{wid}/sharees/{sid}/members/{uid}` | Remove from this Client only. |

### Grants

| Method | Endpoint | Body / notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{wid}/grants` | Filter with `?subject_id=` / `?resource_type=` / `?resource_id=`. |
| `POST` | `/v1/workspaces/{wid}/grants` | See below. |
| `DELETE` | `/v1/workspaces/{wid}/grants/{gid}` | Hard revoke (effective within ~60s of cache). |

Grant body:

```json
{
  "subject_type": "sharee",          // "sharee" (whole org) or "external_user" (one person)
  "subject_id": "shr_…",             // sharee id, or a users.id
  "resource_type": "folder",          // "folder", "artifact", or "file"
  "resource_id": "fld_…",
  "capability": "view"                // view | comment | create | edit
}
```

- Capability lattice: `manage > edit > create / comment > view`. A `comment` grant satisfies `view` but not `edit` (reviewer ≠ editor).
- `create` is **folder-only** — it lets the external author NEW artifacts fenced inside that folder. A created artifact is forced **private** and pinned to the folder; externals can't publish workspace-wide or to the root.
- A folder grant covers every artifact in that folder's subtree.

### Scoped API tokens

For an external member to use the API (read their granted data programmatically), mint a token bound to them. Unlike a workspace Agent token, an external token is **never workspace-blanket** — every read/write resolves through that user's grants.

| Method | Endpoint | Body / notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{wid}/sharees/{sid}/members/{uid}/tokens` | List (no secrets). |
| `POST` | `/v1/workspaces/{wid}/sharees/{sid}/members/{uid}/tokens` | `{ "scopes": ["data:read"] }` → `{ token: "sot_…", shown_once: true }`. |
| `DELETE` | `/v1/workspaces/{wid}/sharees/{sid}/members/{uid}/tokens/{tid}` | Revoke. |

External token scopes are limited to `artifacts:read`, `data:read`, `data:write` — **never** `artifacts:publish`. Even with `data:write`, a write needs an `edit` grant; a `view`-only external is read-only. The plaintext token is shown once.

### Activity / read receipts

| Method | Endpoint | Returns |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{wid}/sharees/{sid}/activity` | Recent views for one Client. |
| `GET` | `/v1/workspaces/{wid}/sharee-activity` | Recent views across all Clients. |

A receipt is logged when an external member opens a granted artifact (deduped per hour) — the renewal/upsell signal: "Acme opened the Q3 deck 9× this week."

## The external member's experience

1. Accept the invite → log in (Google or email-OTP, same as any ShareOut user).
2. Go to **`/shared`** → the portal listing every page and file granted to them, branded by their Client. First visit shows a short orientation card.
3. Open a page or download a file → access succeeds if they hold a `view` grant (direct or via an ancestor folder); otherwise access is denied.

## Client notes (AI memory about a client)

Each Client can hold **workspace-private markdown notes** — account intel, preferences, history, next steps. This **reuses the Intelligence module** (`workspace_files`, `namespace='context'`), scoped to a Client by `scope_id`. Notes are info ABOUT the client and are **never shared with them**.

- The **workspace assistant auto-reads** the relevant client's notes when that client is in context (injected into the home/workspace agent snapshot, within a size budget).
- The assistant can **write them back** via the `set_client_notes` tool, so notes stay current ("admin or AI keeps them up to date").
- **Read = any internal member; write = admin** (or the in-workspace agent). Externals never see these.

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{wid}/sharees/{sid}/context` | List a client's notes (member). |
| `GET` | `/v1/workspaces/{wid}/sharees/{sid}/context/{name}` | Read one note (markdown). |
| `PUT` | `/v1/workspaces/{wid}/sharees/{sid}/context/{name}` | Create/replace (admin). Raw markdown or `{ "content": "..." }`. Names are lowercase `*.md`, ≤64KB, ≤100 files per client. |
| `DELETE` | `/v1/workspaces/{wid}/sharees/{sid}/context/{name}` | Delete (admin). |

Manage in **Admin → Sharing → [client] → Notes about this client**. Deleting a Client deletes its notes.

## Billing

External members are **$0 and uncapped**. `getBillableSeats` counts only internal members; the billing page shows a separate "External members — included" line. A high anti-abuse ceiling exists (spam guard, not a paywall).

## Errors

| Code | Meaning |
| --- | --- |
| `403 EXTERNAL_SHARING_NOT_ENTITLED` | Workspace not on Teams/Enterprise — can't create Clients/members/grants/tokens. Read access for existing grants is unaffected. |
| `403 FORBIDDEN` | Caller is not a workspace admin. |
| `400 VALIDATION_ERROR` | Bad capability/resource (e.g. `create` on an artifact — it's folder-only), or unknown subject/resource for this workspace. |
