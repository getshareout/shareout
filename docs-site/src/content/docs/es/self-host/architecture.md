---
title: Arquitectura self-host
description: Tres planos, bindings de storage, y cómo se cablea una instancia self-hosted de ShareOut.
---

ShareOut es un Cloudflare Worker que publica y sirve artifacts HTML interactivos.
Toda instalación es self-hosted en **tu** cuenta de Cloudflare — la configuración
(orígenes, roster de admin, bindings opcionales) es el desvío.

## Tres planos

1. **Control** — API REST, auth, admin de workspace (`/v1/*`, `/auth/*`, `/home`).
2. **Storage** — D1 (metadata), R2 (HTML/assets), KV (slugs / rate limits),
   Durable Objects (tablas, realtime, MiniDB, chat, …).
3. **Execution** — HTML del artifact sandboxed en el browser + SDK ShareOut
   (`json` → `table` → realtime).

## Orígenes

| Var | Rol |
|-----|-----|
| `SHAREOUT_BASE_URL` | Apex confiable de la app (cookies, OAuth callback, URLs canónicas). |
| `ARTIFACT_ORIGIN` | Host opcional de contenido no confiable. Unset ⇒ paths same-zone. |

Los subdominios de workspace (`https://acme.<apex>/…`) necesitan DNS wildcard al
worker. Sin wildcard, usá `/@workspace/slug` y `/a/<slug>/` en el apex.

## Knobs típicos de self-host

| | |
|--|--|
| Admin | Primer usuario en `/setup`, o `SETUP_ADMIN_EMAIL` para fijar quién lo reclama |
| Marketing site | Opcional — `MARKETING_ORIGIN` a tu sitio, o sin setear |
| Dominio custom | El tuyo — actualizá `SHAREOUT_BASE_URL` después del DNS |

## Relacionado

- [Overview self-host](/es/self-host/overview/)
- [Secrets](/es/self-host/secrets/)
- [Ops](/es/self-host/ops/)
- Mapa para agents: `AGENTS.md` en el repo público
