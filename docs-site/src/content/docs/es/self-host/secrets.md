---
title: Secrets self-host
description: Secrets y vars del Worker requeridos vs opcionales para una instancia self-hosted.
---

Secrets con `npx wrangler secret put NAME` (o el dashboard de Cloudflare).
Vars en `wrangler.toml` `[vars]` o la pestaña **Variables**.

## Requeridos para bootear

| Nombre | Tipo | Notas |
|--------|------|--------|
| `SESSION_SECRET` | secret | String largo al azar (`openssl rand -hex 32`). Firma sesiones y tokens. |
| `SHAREOUT_BASE_URL` | var | Origen público de esta instancia, sin barra final. |

D1, R2, KV y Durable Objects vienen de `wrangler.toml` — el botón Deploy
provisiona nombres; reemplazá IDs placeholder después del create si hace falta.

## Muy recomendado

| Nombre | Tipo | Notas |
|--------|------|--------|
| `SETUP_ADMIN_EMAIL` | var | El primer admin debe coincidir; si no, el primer usuario firmado es admin mientras nada nombre uno. |
| `INSTANCE_ADMIN_EMAILS` | var | Emails separados por coma con acceso a `/admin`. Cómo agregar un dueño de instancia sin editar código — ver [Ops](/es/self-host/ops/#administrar-la-instancia). |

## Auth y mail opcionales

| Nombre | Tipo | Notas |
|--------|------|--------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | Habilita Google en `/auth/login`. Callback: `{SHAREOUT_BASE_URL}/auth/callback`. |
| — | — | **El login con contraseña no necesita configuración.** Está siempre disponible y es como `/setup` crea el primer admin. |
| Binding `EMAIL` | binding | Habilita los códigos de un solo uso por email. Sin él, esos códigos solo llegan al log del worker. |
| `EMAIL_DEFAULT_FROM` | var | From cuando Email está bound. |

## Features de producto opcionales

| Nombre | Tipo | Notas |
|--------|------|--------|
| `ARTIFACT_ORIGIN` | var | Segundo origen para contenido no confiable; unset = same-zone. |
| `ADMIN_ALERTS_DISABLED` | var | `1` silencia alertas Telegram/ops (default del template OSS). |
| `TEAM_METRICS_ENABLED` | var | `0` en self-host (default del template OSS). |
| `STORAGE_QUOTA_BYTES` / `STORAGE_MAX_FILE_BYTES` | var | Topes de almacenamiento por dueño. Sin setear o `0` = ilimitado, el default. |
| `DAILY_BANDWIDTH_BYTES_PER_OWNER` | var | Pausa los artifacts públicos de un dueño que supere este egreso diario estimado. Sin setear o `0` = sin tope, el default. |
| `ARTIFACT_BADGE` | var | `1` agrega un badge "Made with ShareOut" a los artifacts públicos. Apagado por defecto. |
| `OPEN_VISIBILITY_DISABLED` | var | `1` mantiene todo privado; sin enlaces públicos. |
| `ADMIN_BRIDGE_SECRET` | secret | **Dejalo unset** salvo que corras un bridge worker privado. Unset ⇒ `/internal/admin/*` deniega todo. |
| Tokens Telegram / Slack | secret | Solo si usás esas integraciones. |
| `OPENAI_API_KEY` / `VERCEL_AI_GATEWAY` | secret | **La AI está apagada hasta setear una** — Crew, asistentes, editor AI, knowledge. Ver [Ops → Proveedores de AI](/es/self-host/ops/#proveedores-de-ai). |
| `CREDENTIALS_KEY` | secret | `openssl rand -hex 32`. Cifra las keys de AI por workspace y las credenciales de conectores; esos endpoints se niegan sin esto. |

## Desarrollo local

Copiá `shareout-app/.dev.vars.example` → `.dev.vars` y seteá al menos
`SESSION_SECRET`. Usá `/auth/dev?email=vos@ejemplo.com&redirect=/home` para una
sesión sin OAuth.
