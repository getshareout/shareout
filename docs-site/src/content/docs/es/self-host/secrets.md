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
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | secret | Habilita **Entrar con Microsoft** (cuentas personales y de trabajo o escuela) en `/auth/login` y en el login de páginas privadas. Callback: `{SHAREOUT_BASE_URL}/auth/microsoft/callback`. Ver [abajo](#entrar-con-microsoft). |
| `MICROSOFT_TENANT` | var | Opcional. `common` (default: personales + trabajo/escuela), `organizations` (solo trabajo/escuela), `consumers` (solo personales) o el GUID de un tenant. Cualquier otro valor oculta el botón. |
| — | — | **El login con contraseña no necesita configuración.** Está siempre disponible y es como `/setup` crea el primer admin. |
| Binding `EMAIL` | binding | Habilita los códigos de un solo uso por email. Sin él, esos códigos solo llegan al log del worker. |
| `EMAIL_DEFAULT_FROM` | var | From cuando Email está bound. |

## Entrar con Microsoft

Un solo registro de app en Microsoft Entra sirve para toda la instancia. En el
[centro de administración de Microsoft Entra](https://entra.microsoft.com), en tu propio tenant:

1. **Entra ID → App registrations → New registration.** El nombre es lo que la gente ve en
   la pantalla de consentimiento de Microsoft. **Supported account types:**
   - **Any Entra ID Tenant + Personal Microsoft accounts** con `MICROSOFT_TENANT` sin
     definir (`common`);
   - **Multiple Entra ID tenants** con `MICROSOFT_TENANT=organizations`;
   - **Single tenant only** con `MICROSOFT_TENANT=<Directory (tenant) ID>`.
2. **Authentication → Add Redirect URI → Web:** `{SHAREOUT_BASE_URL}/auth/microsoft/callback`.
3. **Certificates & secrets → Client secrets → New client secret.** Copiá el **Value**
   (se muestra una sola vez) en `MICROSOFT_CLIENT_SECRET`, y **Overview → Application
   (client) ID** en `MICROSOFT_CLIENT_ID`. Microsoft recomienda secrets que venzan en menos
   de 12 meses; rotalo antes del vencimiento.
4. **Token configuration → Add optional claim → ID:** `email` y `xms_edov` (aceptá el aviso
   que agrega el permiso `email` de Microsoft Graph).
5. Recomendado: que Entra saque de los tokens las direcciones sin verificar —
   `PATCH https://graph.microsoft.com/v1.0/applications/{object-id}/authenticationBehaviors`
   con `{"removeUnverifiedEmailClaim": true}`.
6. Apps multi-tenant: completá la **verificación del publisher** (Branding & properties);
   si no, las organizaciones que solo permiten consentir apps verificadas bloquean el login.

**Cómo se confía en el email.** Microsoft documenta el claim `email` como no verificado y
mutable, y ShareOut vincula una cuenta existente por email. Por eso: las cuentas personales
de Microsoft (tenant `9188040d-6c67-4c5b-b112-36a304b66dad`) usan su `email`, o un
`preferred_username` con forma de email; las de trabajo o escuela se aceptan solo con
`xms_edov` en true (el dueño del dominio verificó la dirección), nunca desde
`preferred_username`. Después la cuenta queda atada al `tid:oid` del token: si esa dirección
aparece más adelante con otra identidad de Microsoft, se rechaza en vez de fusionarse. Los
usuarios deshabilitados se rechazan, y las direcciones de un dominio con
[SSO del workspace obligatorio](/es/teams/sso/) se mandan a ese IdP.

Los tokens se validan contra las claves de Microsoft (`/discovery/v2.0/keys`): firma, el
issuer `{tenantid}` resuelto con el `tid` (un GUID) del token, el issuer de la propia clave,
audiencia (el client ID), vencimiento y el nonce de la cookie de estado firmada (con PKCE).

## Features de producto opcionales

| Nombre | Tipo | Notas |
|--------|------|--------|
| `ARTIFACT_ORIGIN` | var | Segundo origen para contenido no confiable; unset = same-zone. |
| `TEAM_METRICS_ENABLED` | var | `0` en self-host (default del template OSS). |
| `STORAGE_QUOTA_BYTES` / `STORAGE_MAX_FILE_BYTES` | var | Topes de almacenamiento por dueño. Sin setear o `0` = ilimitado, el default. |
| `DAILY_BANDWIDTH_BYTES_PER_OWNER` | var | Pausa los artefactos públicos de un dueño que supere este egreso diario estimado. Sin setear o `0` = sin tope, el default. |
| `ARTIFACT_BADGE` | var | `1` agrega un badge "Made with ShareOut" a los artefactos públicos. Apagado por defecto. |
| `OPEN_VISIBILITY_DISABLED` | var | `1` mantiene todo privado; sin enlaces públicos. |
| `ADMIN_BRIDGE_SECRET` | secret | **Dejalo unset** salvo que corras un bridge worker privado. Unset ⇒ `/internal/admin/*` deniega todo. |
| Tokens Telegram / Slack | secret | Solo si usás esas integraciones. |
| `OPENAI_API_KEY` / `VERCEL_AI_GATEWAY` | secret | **La AI está apagada hasta setear una** — Crew, asistentes, editor AI, knowledge. Ver [Ops → Proveedores de AI](/es/self-host/ops/#proveedores-de-ai). |
| `CREDENTIALS_KEY` | secret | `openssl rand -hex 32`. Cifra las keys de AI por workspace y las credenciales de conectores; esos endpoints se niegan sin esto. |

## Desarrollo local

Copiá `shareout-app/.dev.vars.example` → `.dev.vars` y seteá al menos
`SESSION_SECRET`. Usá `/auth/dev?email=vos@ejemplo.com&redirect=/home` para una
sesión sin OAuth.
