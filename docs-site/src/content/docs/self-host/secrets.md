---
title: Self-host secrets
description: Required vs optional Worker secrets and vars for a self-hosted ShareOut instance.
---

Set secrets with `npx wrangler secret put NAME` (or the Cloudflare dashboard).
Vars go in `wrangler.toml` `[vars]` or the dashboard **Variables** tab.

## Required for a working boot

| Name | Kind | Notes |
|------|------|--------|
| `SESSION_SECRET` | secret | Long random string (`openssl rand -hex 32`). Signing sessions & tokens. |
| `SHAREOUT_BASE_URL` | var | Public origin of this instance, no trailing slash. Must match what browsers and agents call. |

D1, R2, KV, and Durable Object bindings come from `wrangler.toml` — the Deploy
button provisions names; replace placeholder IDs after create if needed.

## Strongly recommended

| Name | Kind | Notes |
|------|------|--------|
| `SETUP_ADMIN_EMAIL` | var | First admin must match this email; otherwise the first signed-in user becomes admin while nothing names one. |
| `INSTANCE_ADMIN_EMAILS` | var | Comma-separated emails with `/admin` access. How you add an instance owner without editing source — see [Ops](/self-host/ops/#running-the-instance). |

## Optional auth & mail

| Name | Kind | Notes |
|------|------|--------|
| — | — | **Password sign-in needs no configuration.** It is always available and is how `/setup` creates the first admin. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | Enables Google on `/auth/login`. Callback: `{SHAREOUT_BASE_URL}/auth/callback`. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | secret | Enables **Sign in with Microsoft** (personal and work/school accounts) on `/auth/login` and private-page sign-in. Callback: `{SHAREOUT_BASE_URL}/auth/microsoft/callback`. See [below](#sign-in-with-microsoft). |
| `MICROSOFT_TENANT` | var | Optional. `common` (default: personal + work/school), `organizations` (work/school only), `consumers` (personal only), or one directory's tenant GUID. Any other value hides the button. |
| `GOOGLE_DRIVE_SA_KEY` | secret | Enables folder import from Google Drive **by sharing**: people share a folder with their workspace's own email; no OAuth consent, no Google verification. The JSON key of one service account that creates and impersonates a keyless account per workspace. See [below](#google-drive-by-sharing). When set, folder import uses it instead of the `drive.readonly` consent below (the spreadsheet sync keeps its own). |
| `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` | secret | Enables folder import from Google Drive (read-only `drive.readonly`, a restricted scope; its own OAuth client — not the login one) and the scheduled spreadsheet sync (Automate → *Sync data from Google Drive*), which asks its own consent for `drive.file` only, with the Google Picker inside it. Enable the **Google Picker API** in the same Cloud project. Redirect (both): `{SHAREOUT_BASE_URL}/v1/file-imports/oauth/google_drive/callback`. Needs `CREDENTIALS_KEY`. While the consent screen is in *Testing*, Google expires refresh tokens after 7 days, so scheduled syncs stop; publish it for real use. |
| `GOOGLE_DRIVE_FILE_CLIENT_ID` / `GOOGLE_DRIVE_FILE_CLIENT_SECRET` | secret | Optional. An OAuth client in a **separate Cloud project** for the spreadsheet sync only (for example a published project that declares just `drive.file`, while folder import's stays in Testing). Same redirect URI; enable the Google Picker API in that project. Don't use a second client in the same project: Google revokes per project, and ShareOut treats a different client as a different project when a disconnect decides whether to revoke. Unset = the sync uses `GOOGLE_DRIVE_CLIENT_ID`. |
| `MICROSOFT_FILES_CLIENT_ID` / `MICROSOFT_FILES_CLIENT_SECRET` / `MICROSOFT_FILES_TENANT` | secret / var | Enables folder import from OneDrive / SharePoint (delegated `Files.Read.All`, `Sites.Read.All`, `User.Read`, `offline_access`). Tenant defaults to `common`. Redirect: `{SHAREOUT_BASE_URL}/v1/file-imports/oauth/microsoft/callback`. |
| Email binding `EMAIL` | binding | Enables emailed one-time codes. Without it those codes only reach the worker log. |
| `EMAIL_DEFAULT_FROM` | var | From-address when Email is bound. |

## Google Drive by sharing

Each workspace gets its own Google service account. People share a Drive folder with
that email as Viewer and ShareOut reads it as that account — so a workspace can only
ever see what was shared with its own email (Google enforces it). One key for the
instance; the per-workspace accounts have none.

In a Google Cloud project that holds nothing else (the key can impersonate every
service account in it):

```sh
P=<project-id>
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

- **Key creation blocked?** Organizations created on or after 2024-05-03 enforce
  `iam.disableServiceAccountKeyCreation`; override it on this project only.
- **How many workspaces:** Google limits service accounts per project ("varies depending
  on the project"). Read yours with `gcloud quotas info list --service=iam.googleapis.com
  --project=$P` (look for *Service Account Count*) or in the console under IAM quotas, and
  request more if needed. A workspace that cannot get its own account sees a clear error
  (`SHARE_EMAIL_LIMIT`) — it is never given a shared one. The worker logs
  `Google service-account limit reached`.
- **Rotate:** create a second key on `shareout-drive-minter`, `wrangler secret put` it,
  check an import, then delete the old key. **Revoke everything:** delete the key.
- Deleted workspaces have their account deleted by the hourly cron.

## Sign in with Microsoft

One Microsoft Entra app registration serves the whole instance. In the
[Microsoft Entra admin center](https://entra.microsoft.com), in your own tenant:

1. **Entra ID → App registrations → New registration.** The name is what people see on
   Microsoft's consent screen. **Supported account types:**
   - **Any Entra ID Tenant + Personal Microsoft accounts** with `MICROSOFT_TENANT` unset
     (`common`);
   - **Multiple Entra ID tenants** with `MICROSOFT_TENANT=organizations`;
   - **Single tenant only** with `MICROSOFT_TENANT=<Directory (tenant) ID>`.
2. **Authentication → Add Redirect URI → Web:** `{SHAREOUT_BASE_URL}/auth/microsoft/callback`.
3. **Certificates & secrets → Client secrets → New client secret.** Copy the **Value**
   (shown once) into `MICROSOFT_CLIENT_SECRET`; **Overview → Application (client) ID** into
   `MICROSOFT_CLIENT_ID`. Microsoft recommends secrets that expire in under 12 months;
   rotate before expiry.
4. **Token configuration → Add optional claim → ID:** `email` and `xms_edov` (accept the
   prompt to add the Microsoft Graph `email` permission).
5. Recommended: have Entra strip unverified addresses from tokens —
   `PATCH https://graph.microsoft.com/v1.0/applications/{object-id}/authenticationBehaviors`
   with `{"removeUnverifiedEmailClaim": true}`.
6. Multi-tenant apps: complete **publisher verification** (Branding & properties), or
   organizations that only allow consent to verified publishers will block sign-in.

**How email is trusted.** Microsoft documents the `email` claim as unverified and mutable,
and ShareOut links an existing account by email. So: personal Microsoft accounts
(tenant `9188040d-6c67-4c5b-b112-36a304b66dad`) use their `email`, or an email-shaped
`preferred_username`; work/school accounts are accepted only with `xms_edov` true (the
domain owner verified the address), never from `preferred_username`. The account is then
keyed by the token's `tid:oid`: an address that later shows up under a different Microsoft
identity is refused, not merged. Disabled users are refused, and addresses on an
[enforced workspace SSO](/teams/sso/) domain are sent to that IdP instead.

Tokens are checked against Microsoft's keys (`/discovery/v2.0/keys`): signature, the
`{tenantid}` issuer resolved from the token's GUID `tid`, the key's own issuer, audience
(the client ID), expiry and the nonce from the signed state cookie (PKCE included).

## Optional product features

| Name | Kind | Notes |
|------|------|--------|
| `ARTIFACT_ORIGIN` | var | Second origin for untrusted content; unset = same-zone. |
| `TEAM_METRICS_ENABLED` | var | `0` on self-host (OSS template default). |
| `STORAGE_QUOTA_BYTES` / `STORAGE_MAX_FILE_BYTES` | var | Per-owner storage caps. Unset or `0` = unlimited, the default. |
| `DAILY_BANDWIDTH_BYTES_PER_OWNER` | var | Auto-pause an owner's public artifacts over this daily estimated egress. Unset or `0` = no cap, the default. |
| `ARTIFACT_BADGE` | var | `1` adds a "Made with ShareOut" badge to public artifacts. Off by default. |
| `OPEN_VISIBILITY_DISABLED` | var | `1` keeps every artifact private; no public links. |
| `ADMIN_BRIDGE_SECRET` | secret | **Leave unset** unless you run a private bridge worker. Unset ⇒ `/internal/admin/*` denies all. |
| Telegram / Slack bot tokens | secret | Only if you use those integrations. |
| `ANTHROPIC_API_KEY` / `VERCEL_AI_GATEWAY` / `OPENAI_API_KEY` | secret | **AI is off until one is set** — Crew, assistants, editor AI, knowledge. See [Ops → AI providers](/self-host/ops/#ai-providers). |
| `CREDENTIALS_KEY` | secret | `openssl rand -hex 32`. Encrypts per-workspace AI keys and connector credentials; those endpoints refuse without it. |

## Local development

Copy `shareout-app/.dev.vars.example` → `.dev.vars` and set at least
`SESSION_SECRET`. Use `/auth/dev?email=you@example.com&redirect=/home` for a
session without OAuth.
