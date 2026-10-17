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
| `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` | secret | Enables folder import from Google Drive (read-only `drive.readonly`, its own OAuth client — not the login one). Redirect: `{SHAREOUT_BASE_URL}/v1/file-imports/oauth/google_drive/callback`. Needs `CREDENTIALS_KEY`. |
| `MICROSOFT_FILES_CLIENT_ID` / `MICROSOFT_FILES_CLIENT_SECRET` / `MICROSOFT_FILES_TENANT` | secret / var | Enables folder import from OneDrive / SharePoint (delegated `Files.Read.All`, `Sites.Read.All`, `User.Read`, `offline_access`). Tenant defaults to `common`. Redirect: `{SHAREOUT_BASE_URL}/v1/file-imports/oauth/microsoft/callback`. |
| Email binding `EMAIL` | binding | Enables emailed one-time codes. Without it those codes only reach the worker log. |
| `EMAIL_DEFAULT_FROM` | var | From-address when Email is bound. |

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
