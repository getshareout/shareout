---
title: Self-host threat model
description: Trust boundaries and rate-limit posture for a self-hosted ShareOut Worker before public exposure.
---

This is an operator-facing map, not a penetration-test report. Fix items below
before announcing a public self-host build widely.

## Trust boundaries

| Boundary | Trust | Notes |
|----------|-------|--------|
| Browser → Worker (apex) | Session cookie / API token | CSRF via SameSite; CORS locked to app origins |
| Artifact HTML → data API | Artifact + capability tokens | Sandbox / CSP; optional split `ARTIFACT_ORIGIN` |
| `/internal/admin/*` | Bearer `ADMIN_BRIDGE_SECRET` | **Leave unset on OSS** — missing secret denies all |
| Super-admin UI | Roster / `SETUP_ADMIN_EMAIL` / first user | Self-host: empty roster + first signup |
| Email OTP | Turnstile (when configured) + per-email DB caps + per-IP KV limits | Codes log to worker when `EMAIL` unbound |

## High-value mutations (rate limited)

| Surface | Limit mechanism |
|---------|-----------------|
| `POST /v1/publish` | D1 daily publish quota (`api-auth`) |
| `POST …/present` | D1 present quota (10/hour) |
| Email OTP start/verify | KV IP windows + email DB caps |
| `POST /v1/access-requests` | KV per user |
| Public abuse `/report/*` | KV anonymous + trusted CF IP |
| `POST /internal/admin/ask` | KV (requires bridge secret) |

## Self-host checklist

1. Do **not** set `ADMIN_BRIDGE_SECRET` unless you run a separate bridge worker you control.
2. Set a unique long `SESSION_SECRET`.
4. Keep artifacts private until you understand open visibility / moderation.
5. Enable Turnstile for OTP if the instance is internet-facing.
6. Review Cloudflare WAF / bot fight mode on your zone.
7. Report vulns via [SECURITY.md](https://github.com/getshareout/shareout/blob/main/SECURITY.md).

## API error surface

Public JSON errors use a stable envelope (`success: false`, `error`, `code`,
optional `request_id` / `hint`). Unhandled exceptions always return
`code: INTERNAL_ERROR` with a generic message — stacks and raw exception text
are logged server-side only (`X-Request-Id` correlates logs to the response).

## Still open for a full launch audit

- Broader mutation inventory beyond the table above (admin moderation routes are
  session-gated as super-admin only — no extra KV quota yet).
- Automated fuzz of capability-token / CDN paths.
- Independent review of artifact sandbox escapes.
- Empty `catch {}` sites that swallow errors without logging (inventory in
  code review; prefer `logError` or rethrow with context).

See also: [Ops](/self-host/ops/) · [Secrets](/self-host/secrets/).
