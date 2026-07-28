# Workspace Publish Governance

Workspace owners and admins can gate when **members** take workspace artifacts to public visibility. Personal artifacts (no `workspace_id`) are unaffected. Workspace `owner` and `admin` roles bypass the member approval flow.

Load [SKILL.md](SKILL.md) first.

## Policies

| Policy | Effect on members publishing or PATCHing to open visibility |
| --- | --- |
| `allow` *(default)* | No workspace gate — platform moderation still runs on first open publish. |
| `prohibit` | Visibility forced to `workspace` (team-visible, not world). Response includes a `notice`. |
| `require_approval` | Visibility forced to `workspace` until nominated approvers all approve. Response includes `notice` and `approval_required`. |

Configure per workspace:

```http
GET  /v1/workspaces/{workspaceId}/publish-policy
PATCH /v1/workspaces/{workspaceId}/publish-policy
Authorization: Bearer {token}
Content-Type: application/json

{ "policy": "require_approval", "approvals_required": 2 }
```

`approvals_required` is `1`–`10` when policy is `require_approval`. Writes require workspace `admin` or `owner`.

## Gate behaviour

When a **member** publishes or `PATCH`es visibility to `public`, the gate runs **before** platform safety review:

```json
{
  "deployment": { "url": "…" },
  "notice": "Your workspace requires approval to publish publicly. Kept visible to your workspace — request approval from 2 teammate(s).",
  "approval_required": { "required": 2, "artifact_id": "art_abc123" }
}
```

Under `prohibit`, only the `notice` is returned (no `approval_required`).

After workspace approval, the artifact flips to the requested visibility and the automated safety review still runs. Approval is tied to the artifact's **content hash** — unchanged re-publishes stay approved.

## Request approval

The requester nominates **exactly** `approvals_required` workspace members (not themselves):

```http
POST /v1/artifacts/{artifactId}/publish-approval
Authorization: Bearer {token}
Content-Type: application/json

{
  "visibility": "public",
  "approver_ids": ["usr_a", "usr_b"]
}
```

Each nominated approver decides:

```http
POST /v1/artifacts/{artifactId}/publish-approval/{requestId}/decision
Authorization: Bearer {token}
Content-Type: application/json

{ "decision": "approve" }
```

Use `"decision": "reject"` to cancel the request. **All** nominated approvers must approve; any rejection ends the request.

## List pending requests

Any workspace member may list requests:

```http
GET /v1/workspaces/{workspaceId}/publish-approvals?status=pending
Authorization: Bearer {token}
```

Each row includes `approvals_required`, `approved_count`, `artifact_slug`, and `viewer_can_decide` (whether the current user is a nominated approver with a pending vote).

## In-app surfaces (Phase 2)

When `require_approval` is active, members and admins can drive the flow in the ShareOut app — no API scripting required:

| Surface | Who | What |
| --- | --- | --- |
| **Admin → Settings** | `admin`/`owner` | Set policy (`allow` / `prohibit` / `require_approval`) and `approvals_required` (1–10). |
| **Home bulk visibility** | Member requester | Changing visibility to `public` opens an approver picker (exactly N workspace members). |
| **Editor visibility select** | Member requester | Same picker when a held change needs nomination. |
| **Approvals queue** | Any member | Left-nav **Approvals** view + badge; nominated approvers approve/reject; requesters see pending items. |

`PATCH /v1/artifacts/{id}` with `{ "visibility": "public" }` returns **202** with `approval_required: { required, artifact_id, visibility, workspace_id }` when the gate holds the change — same shape as publish. Do not treat this as a successful open visibility flip until approvers act.

## Agent checklist

- Check `GET …/publish-policy` before promising a public URL for a workspace artifact.
- When `approval_required` appears in a publish response, explain the artifact is team-visible until approvers act — do not treat `deployment.url` as world-public yet.
- Nominate real workspace member user ids; count must match `approvals_required`.
- Open visibility still requires platform moderation clearance — workspace approval is not a substitute.

## Related

- [../modules/_shared/publishing.md](../modules/_shared/publishing.md) — visibility model and public-artifact rules
- [api.md](api.md#workspace-publish-governance) — endpoint table
- [SKILL.md](SKILL.md#workspace-admin-surfaces) — admin surfaces
