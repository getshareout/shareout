---
title: Self-host ShareOut
description: Desplegá tu propia instancia de ShareOut en Cloudflare Workers — botón Deploy, secrets y primer admin.
---

import { Steps } from '@astrojs/starlight/components';

Corré ShareOut en **tu** cuenta de Cloudflare. ShareOut es **solo self-hosted** —
no hay cloud de ShareOut ni checkout. Necesitás una cuenta de Cloudflare y el plan
**Workers Paid** de Cloudflare (Durable Objects); esa facturación es de Cloudflare,
no de ShareOut.

## Requisitos

- Cuenta de Cloudflare con **[Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/)**
  (requerido — Durable Objects alimentan tablas, realtime y chat; plan de Cloudflare, no un fee de ShareOut)
- Node 24+ para desarrollo local
- Acceso a GitHub al repo público de ShareOut (el botón Deploy lo clona)

## Deploy

<Steps>

1. **CLI (unos cinco minutos)** — recomendado:

   ```bash
   git clone https://github.com/getshareout/shareout.git
   cd shareout/shareout-app
   npm ci
   npx wrangler login
   npm run deploy   # provisiona D1/R2/KV + SESSION_SECRET + BASE_URL, migra y despliega
   ```

   O **Deploy to Cloudflare** desde el [README del repo público](https://github.com/getshareout/shareout)
   con **Root directory** `shareout-app` y **Deploy command** `npm run deploy`
   (no `npx wrangler deploy` a secas).

2. **Abrí la URL del worker.** Una DB vacía redirige a `/setup`. Creá el primer
   admin con email y contraseña — sin proveedor de correo ni OAuth.

3. **Publicá un hello** para probar el camino:

   ```bash
   export SHAREOUT_ORIGIN=https://shareout.<tu-cuenta>.workers.dev
   export SHAREOUT_TOKEN=so_…   # Settings → API tokens después de entrar
   npm run smoke:hello
   ```

4. **Probá el data plane** (JSON, tablas, datasets):

   ```bash
   export SHAREOUT_ORIGIN=… SHAREOUT_TOKEN=…
   npm run smoke:data
   ```

   Guía: [Smoke del data plane](/es/self-host/data-smoke/).

5. **Day 1** — clave de AI si querés Crear con AI / Crew; invitá a alguien; apuntá
   agentes a `GET $ORIGIN/v1/skill` con `origin` en `~/.shareout/credentials`. Ver el
   [README del repo → Day 1](https://github.com/getshareout/shareout#day-1-after-health-is-green).

</Steps>

## Pasos opcionales

| Objetivo | Qué hacer |
|----------|-----------|
| Dominio custom | Adjuntá ruta/dominio en Cloudflare; actualizá `SHAREOUT_BASE_URL` |
| Google sign-in | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`; callback `{origin}/auth/callback` |
| OTP por email real | Binding `EMAIL` + vars de from-address |
| Subdominios de workspace | DNS wildcard `*.tudominio` → worker; apex = host de `SHAREOUT_BASE_URL` |
| CDN de contenido separado | Seteá `ARTIFACT_ORIGIN` a una segunda zona (hardening opcional) |

Servir same-zone (sin CDN) es el default y alcanza para la mayoría de self-hosts.

## Qué degrada sin bindings de Cloudflare Paid / opcionales

| Binding | Si falta |
|---------|----------|
| Durable Objects | Producto incompleto — planificá Workers Paid (Cloudflare) |
| `EMAIL` | OTP / mails de lifecycle → logs del worker |
| `AI` / `VECTORIZE` | Búsqueda semántica → keyword |
| `BROWSER` | Sin thumbnails / browser smoke |
| Queues | Analytics puede atrasarse o caer a sync |

Detalle: [Arquitectura](/es/self-host/architecture/) · [Ops](/es/self-host/ops/).
