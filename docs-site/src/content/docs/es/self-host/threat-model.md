---
title: Threat model self-host
description: Límites de confianza y postura de rate-limit para un Worker ShareOut self-hosted antes de exposición pública.
---

Mapa orientado a operadores, no un informe de pentest. Arreglá lo de abajo
antes de anunciar un build self-host público de forma amplia.

## Límites de confianza

| Límite | Confianza | Notas |
|--------|-----------|--------|
| Browser → Worker (apex) | Cookie de sesión / API token | CSRF vía SameSite; CORS a orígenes de la app |
| HTML del artifact → data API | Artifact + capability tokens | Sandbox / CSP; `ARTIFACT_ORIGIN` opcional |
| `/internal/admin/*` | Bearer `ADMIN_BRIDGE_SECRET` | **Dejar unset en OSS** — sin secret deniega todo |
| UI super-admin | Roster / `SETUP_ADMIN_EMAIL` / primer usuario | Self-host: roster vacío + primer signup |
| Email OTP | Turnstile (si está) + caps DB por email + KV por IP | Códigos a logs si `EMAIL` no está bound |

## Mutaciones de alto valor (con rate limit)

| Superficie | Mecanismo |
|------------|-----------|
| `POST /v1/publish` | Cuota diaria D1 (`api-auth`) |
| `POST …/present` | Cuota D1 present (10/hora) |
| Email OTP start/verify | Ventanas KV por IP + caps DB por email |
| `POST /v1/access-requests` | KV por usuario |
| Abuse público `/report/*` | KV anonymous + IP confiable de CF |
| `POST /internal/admin/ask` | KV (requiere bridge secret) |

## Checklist self-host

1. **No** setees `ADMIN_BRIDGE_SECRET` salvo que corras un bridge worker aparte que controles.
2. Seteá un `SESSION_SECRET` largo y único.
4. Mantené artifacts privados hasta entender open visibility / moderación.
5. Habilitá Turnstile para OTP si la instancia es internet-facing.
6. Revisá WAF / bot fight mode de Cloudflare en tu zona.
7. Reportá vulns vía [SECURITY.md](https://github.com/getshareout/shareout/blob/main/SECURITY.md).

## Todavía abierto para un audit de launch completo

- Inventario más amplio de mutaciones (rutas de moderación admin están gated por
  sesión super-admin — sin cuota KV extra todavía).
- Fuzz automatizado de capability-token / paths CDN.
- Review independiente de escapes del sandbox de artifacts.

Ver también: [Ops](/es/self-host/ops/) · [Secrets](/es/self-host/secrets/).
