# Google Drive import through a shared service account

Status: **built** (PR #310). Isolation decided 2026-11-18: **one service account per
workspace**, enforced by Google's ACLs — workspaces never mix, and that must not depend on
our code getting every path right. Replaces the `drive.readonly` OAuth consent behind
folder import.

## Why

`drive.readonly` is a restricted scope: Google requires OAuth verification plus a yearly paid
security assessment, and an unverified app keeps "the unverified app screen and the 100-user
cap" ([Google](https://support.google.com/cloud/answer/13464323)). Folder import must stop
depending on it.

The direction: the user shares a folder (or one file) in Drive with an email ShareOut shows
them, as **Viewer**, the way they share with a colleague. ShareOut reads it as that service
account. No consent screen, no user cap. Files added to the folder later inherit its sharing
("All child files and folders automatically inherit permissions from their parent folder",
[Drive API](https://developers.google.com/workspace/drive/api/guides/manage-sharing)), so the
next sync picks them up.

Today: prod never had `GOOGLE_DRIVE_CLIENT_ID/SECRET` set — `file_import_connections` and
`file_import_sources` are both empty (D1, 2026-11-18).

## (a) Isolation — one service account per workspace (decided)

The hard requirement: one workspace must never read a file another workspace shared.

| | **A. One service account per workspace** (chosen) | **B. One shared service account + proof** (rejected) |
|---|---|---|
| Who enforces isolation | **Google.** Workspace B's token cannot open what was shared only with workspace A's account. | **ShareOut code.** The shared account can read every customer's folders; every path that takes a Drive id (folder walk, browse, the sheet sync's `fileId`, anything later) must check the claim. |
| Proof the share is yours | Not needed. | A token placed in the folder (an editor must add a file and never delete it), or Drive's `sharingUser` = the requester's email (fails when the ShareOut email differs from the Google account, when access comes through a group or shared drive, or a colleague shared it; Google documents the field only "if applicable"). |
| "What did we share?" list | Yes — the account's *Shared with me* is exactly this workspace's shares. | No — that list holds every customer's folders. Paste-a-link only. |
| Secrets | One "minter" key (Worker secret). Per-workspace accounts have **no keys**: the minter impersonates them. | One key. |
| Leaked key | Everything (the minter can impersonate every workspace account). | Everything. |
| Limits | Service accounts per project: "Varies depending on the project", raised by quota request ([IAM quotas](https://docs.cloud.google.com/iam/quotas)). Created only for workspaces that open Google import; shard across projects if ever needed. | None. |
| New account usable | "60 seconds or more" after creation ([Google](https://docs.cloud.google.com/iam/docs/service-accounts-create)). Created when the dialog opens; retried with backoff. | Immediately. |
| Ending access | Workspace deleted → its account deleted → access ends at Google. | The customer unshares. |

Also considered and dropped: one Google Group per workspace with the shared account inside. A
Viewer cannot see a file's permissions (the `permissions` field is "only available if the
requesting user can share the file",
[Drive API](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)), so
ShareOut could not tell which group granted access.

**A was chosen.** Isolation is a property of Google's ACLs instead of a check we must get
right on every code path, today and in every future feature.

### Quota, and a workspace that cannot get an account

- Google publishes no default: the service-account count per project "Varies depending on
  the project" ([IAM quotas](https://docs.cloud.google.com/iam/quotas)); the create page says
  the same. No GCP project exists for prod yet, so its real number is read once the project
  is made: `gcloud quotas info list --service=iam.googleapis.com --project=$P` (*Service
  Account Count*), or the console's IAM quotas page. Raise it with a quota request.
- Accounts are created only when a workspace opens Google import, so the count is
  "workspaces that use Drive", not all workspaces.
- At the limit, the workspace gets `503 SHARE_EMAIL_LIMIT` — "this ShareOut instance reached
  Google's limit on share emails. Ask your ShareOut admin to raise it." — and **no account
  at all**: no email, no browse, no token. There is no shared account in the code to fall
  back to. The worker logs `Google service-account limit reached` (error level) for the
  operator. Google documents no error shape for this limit, so a 429, `RESOURCE_EXHAUSTED`,
  or a message mentioning quota / maximum number / limit all count as it.
- The claimed account id is stored before Google is called, so a retry after the limit is
  raised (or after a lost response) creates the same account, never a second one.

### How A works

- `GOOGLE_DRIVE_SA_KEY`: the JSON key of one minter service account in a dedicated GCP project.
  It holds, on that project only: `roles/iam.serviceAccountCreator`,
  `roles/iam.serviceAccountDeleter`, `roles/iam.serviceAccountTokenCreator`.
- The first time a workspace opens Google import, ShareOut creates
  `so-<random>@<project>.iam.gserviceaccount.com` and stores its email and numeric id in
  `file_import_service_accounts (workspace_id PRIMARY KEY, …)`.
- Each Drive call: the Worker signs an RS256 JWT for the minter (≤1 h) → `oauth2.googleapis.com/token`
  → minter token → `iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/<ws account>:generateAccessToken`
  with scope `drive.readonly`, lifetime ≤3600 s ([Google](https://docs.cloud.google.com/iam/docs/create-short-lived-credentials-direct)).
  Quota: "Requests to generate credentials — 60,000 per project per minute". Both tokens are cached
  in memory until a minute before expiry; neither is written to D1.
- A workspace's token is only ever minted from `serviceAccountFor(workspaceId)` — the one lookup
  isolation depends on, and the one the tests pin.
- Workspace deleted → its service account deleted.

## (b) Key storage and rotation

- The minter key is instance configuration, so it is a **Worker secret**
  (`wrangler secret put GOOGLE_DRIVE_SA_KEY`), the same tier as `CREDENTIALS_KEY`. Encrypting it
  with `CREDENTIALS_KEY` into D1 would add nothing: both keys would sit in the same Worker's
  secrets. OAuth tokens are encrypted in D1 because they are per-user rows; this is not.
- Per-workspace accounts have no keys. D1 holds only their email and numeric id (not secret).
- **Rotate:** create a second key on the minter (max 10 keys per service account, "cannot be
  changed") → `wrangler secret put GOOGLE_DRIVE_SA_KEY` → confirm a Drive check works → delete the
  old key in GCP. Both keys work during the overlap: no downtime.
- **Incident:** delete the minter key in GCP → every Drive read stops at once. One workspace:
  disable its service account.
- Organizations created on or after 2024-05-03 enforce `iam.disableServiceAccountKeyCreation` by
  default ([Google](https://docs.cloud.google.com/resource-manager/docs/organization-policy/restricting-service-accounts)):
  the dedicated project needs an override to create its one key. Keyless (Workload Identity
  Federation) is possible later; not in v1.

## (c) User flow

1. **New → Import from Google Drive.** The dialog shows *Share a folder with ShareOut* with the
   workspace's email and a **Copy** button, and three steps: open the folder in Drive → **Share**
   → paste the email, **Viewer** → **Send**.
2. **Check access** lists what is shared with this workspace (folders first, newest first). A
   pasted Drive link works too.
3. Pick → where it goes → **Start import**, as today. Sync again and daily sync are unchanged.
4. Errors, in plain words:
   - *Not visible yet:* "ShareOut can't see that folder yet. Share it with `<email>` as Viewer,
     then check again."
   - *External sharing blocked:* Drive refuses in the customer's own window, before ShareOut sees
     anything, so the dialog says it up front: "If Drive says you can't share outside your
     organization, your Google Workspace admin blocks it. Ask them to allow sharing outside the
     organization for your team." A service account cannot be allow-listed as a trusted domain
     ("Google service accounts … can't be used as trusted domains",
     [Google](https://knowledge.workspace.google.com/admin/domains/allow-external-sharing-with-only-trusted-domains)),
     so the fallback is upload, or a single sheet through the Drive Picker.
   - *Downloads turned off by the owner:* the existing `DOWNLOAD_RESTRICTED` per-file note.
   - *Access removed later:* the run stops with `NOT_SHARED` — "ShareOut lost access to this
     folder. Share it again with `<email>` as Viewer, then sync again." Daily sync keeps
     trying, so sharing it again resumes it with no other step.
5. **One file:** a spreadsheet shared with the workspace account can feed an artifact dataset
   (`drive_file_sync`) — a follow-up, coordinated with the Picker-based sheet sync.

## (d) Existing `drive.readonly` connections

- **Prod:** nothing to migrate (no client configured, no connections, no sources).
- **Self-hosted instances:** when `GOOGLE_DRIVE_SA_KEY` is set, the folder-import Google tile uses
  the service account and the OAuth Google option is hidden there. The OAuth routes stay for
  instances without the key and for sources made with it; sharing is always explicit
  (`access: 'share'`). Existing OAuth sources keep syncing; their card
  offers **Switch to shared-folder access** — share with the email, the source flips over and
  keeps its ledger (same remote ids, so nothing re-imports).
- The artifact sheet sync moved to its own `drive.file` + Picker consent (merged 2026-11-18), so
  the only code left on `drive.readonly` is the OAuth folder import. Deleting it is a follow-up
  and a product call: it removes Google folder import from instances that have not set
  `GOOGLE_DRIVE_SA_KEY`. The CHANGELOG marks it deprecated now.

## (e) Self-host

```sh
P=<project-id>
gcloud projects create $P
gcloud services enable drive.googleapis.com iam.googleapis.com iamcredentials.googleapis.com --project $P
gcloud iam service-accounts create shareout-drive-minter --project $P
for r in serviceAccountCreator serviceAccountDeleter serviceAccountTokenCreator; do
  gcloud projects add-iam-policy-binding $P \
    --member serviceAccount:shareout-drive-minter@$P.iam.gserviceaccount.com --role roles/iam.$r
done
gcloud iam service-accounts keys create key.json \
  --iam-account shareout-drive-minter@$P.iam.gserviceaccount.com
npx wrangler secret put GOOGLE_DRIVE_SA_KEY < key.json && rm key.json
```

Then check **Service Account Count** under the project's IAM quotas and request more if the
instance will have many workspaces using Google import. Use a project that holds nothing else:
the minter can impersonate every service account in it.

## What was built

1. Migration 0042: `file_import_service_accounts` (one row per workspace, no secrets, no FK so
   it outlives a deleted workspace until the sweep) and `file_import_sources.auth`.
2. `src/file-imports/service-account.ts`: RS256 JWT (WebCrypto), minter token, create / delete
   accounts, `generateAccessToken`, memory-only caches, the hourly sweep of deleted workspaces.
3. `src/file-imports/providers/google-shared.ts`: *Shared with ShareOut* listing, one item by id,
   pasted links. Children and downloads reuse the Google provider with the account's token.
4. Routes: `POST …/share/google_drive`, share-mode browse (`ref`, `link`), shared sources,
   `PATCH { access: 'share' }`. The run loader reads a shared source only through its own
   workspace's account and stops with `NOT_SHARED` when the folder was unshared.
5. UI: the share screen (email + Copy, three steps, the admin-block note, Check access, paste a
   link) and *Switch to sharing* on older sources (en/es).
6. Docs: Drive import and self-host secrets (en/es), OpenAPI, CHANGELOG.
7. Tests (`tests/unit/file-imports/drive-share.test.ts`) against a fake Google whose Drive
   enforces ACLs per account: A cannot list, open, link or import B's folder even knowing its
   id, and every Drive call A makes carries A's account; the limit error leaves A with no
   account and mints nothing; a shared source's run uses only its workspace's account.

## Not verified

- Google's policy text does not address reading files users shared with a service account: its
  "Service-owned Data Only" exemption covers "its own data … not user data". Technically there is
  no consent screen, so no verification gate or user cap applies; the pattern is common, but not
  confirmed against Google's policy.
- The real "Service Account Count" quota of the prod GCP project (needs console access).
- That `sharedWithMe` lists items for a service account — checked live once the minter key exists.
- Listing a folder that lives in a **shared drive** and was shared with the account directly:
  shared sources list children without `driveId` (default corpora). Works in the fake; to be
  checked live.
