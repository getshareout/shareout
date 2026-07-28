# Shared: Permissions Model

Common permission model used across all ShareOut modules.

> Roles control **whether** someone can open or edit an artifact. To control **which rows of data** a viewer sees within one shared artifact (per-customer / multi-tenant), use a [row-level access policy](../../core/access-policy.md) — it filters data server-side by the viewer's identity, and owners/editors bypass it.

## Collaborator Roles

| Role | View | Edit | Present | Versions | Manage Collaborators | Delete |
|------|------|------|---------|----------|---------------------|--------|
| **owner** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **editor** | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **viewer** | ✓ | ✗ | ✗ | ✓ (read) | ✗ | ✗ |

**Workspace admins and owners** can edit **any** artifact in their workspace (treated as **editor** for Live Studio and Edit-Lite) even without a named collaborator invite. Plain workspace **members** still need an explicit **editor** collaborator to edit — workspace membership alone grants **view** on `visibility: "workspace"` artifacts only.

**Linked accounts** on the same Home grid count as **owner** for artifacts owned by any linked identity. See [auth.md](../../auth.md#linked-accounts).

## Managing Collaborators

```javascript
// Add editors
await sdk.collaborators.add(['alice@example.com'], 'editor');

// Add viewers
await sdk.collaborators.add(['bob@example.com', 'carol@example.com'], 'viewer');

// List all collaborators
const collaborators = await sdk.collaborators.list();
// [
//   { email: 'owner@example.com', role: 'owner', added_at: '...' },
//   { email: 'alice@example.com', role: 'editor', added_at: '...' },
//   { email: 'bob@example.com', role: 'viewer', added_at: '...' }
// ]

// Change role (re-add with new role)
await sdk.collaborators.add(['bob@example.com'], 'editor');

// Remove collaborator
await sdk.collaborators.remove('carol@example.com');

// Transfer ownership
await sdk.collaborators.transferOwnership('alice@example.com');
```

## Access requests (private & workspace artifacts)

When a signed-in user opens a **private** or **workspace** artifact they cannot access, the gate screen offers **Request access** (Google Drive style). The owner is notified via Telegram (if linked) and sees pending requests in the **Home** Activity feed (**Needs You**) and inbox banner.

| Endpoint | Method | Who | Action |
|----------|--------|-----|--------|
| `/v1/access-requests` | POST | Signed-in user with verified email | Request viewer access to a page by `slug` |
| `/v1/access-requests/incoming` | GET | Artifact owners | List pending requests across owned pages |
| `/v1/access-requests/{id}` | POST | Owner of the requested page | `{ "action": "approve" \| "deny" }` |

**Create request:**

```http
POST /v1/access-requests
Authorization: Bearer so_xxx
Content-Type: application/json

{ "slug": "my-dashboard" }
```

**Approve** grants `viewer` collaborator access automatically (`addCollaboratorEmails`). Owners can also tap **Approve** / **Deny** on the Telegram notification.

Errors: `EMAIL_REQUIRED` (must sign in with email), `HAS_ACCESS`, `IS_OWNER`, `NOT_PRIVATE` (page already open), duplicate pending returns `{ "status": "pending" }`.

## Checking Permissions

Use `sdk.me()` to read the current viewer's role and identity inside an artifact. It returns `{ role, isOwner, canEdit, email, name }`, sourced from data the platform injects at serve time (works in both sandboxed/cdn and inline modes). Anonymous viewers resolve to `role: 'viewer'`.

```javascript
const me = await sdk.me();

if (me.canEdit) {        // owner or editor
  showEditControls();
} else {
  showViewOnlyMode();    // external viewer / client
}

// me.email / me.name identify the signed-in viewer (null when anonymous),
// useful to attribute actions (e.g. who approved an asset).
```

**Workspace visibility ≠ edit access.** `visibility: "workspace"` lets every workspace member open the live viewer, but only **owner** and **editor** collaborators can open `/a/{slug}/edit` or mutate data. Workspace `member` role does not imply artifact editor access — add editors explicitly.

UI gating is a convenience — server-side permissions and any row-level [access policy](../../core/access-policy.md) are always enforced regardless of what the client shows. Collaborator management (add/remove/transfer) is done via the REST endpoints in [api/artifacts.md](../../api/artifacts.md#collaborator-api), not the browser SDK.

## Module-Specific Extensions

Some modules extend the base permission model:

### Slides: Per-Slide Ownership
See [slides/overview.md](../slides/overview.md) for per-slide ownership.

### Dashboards: Widget-Level Permissions
See [dashboards/overview.md](../dashboards/overview.md) for widget permissions.

## Related

- [Versions](versions.md) - Version access by role
- [Publishing](publishing.md) - Published vs edit mode access
