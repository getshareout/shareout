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
| `GOOGLE_DRIVE_SA_KEY` | secret | Activa la importación de carpetas de Google Drive **compartiendo**: cada workspace comparte una carpeta con su propio email; sin consentimiento OAuth ni verificación de Google. Es la clave JSON de una cuenta de servicio que crea y suplanta una cuenta sin claves por workspace. Ver [más abajo](#google-drive-compartiendo). Si está, la importación de carpetas la usa en vez del consentimiento `drive.readonly` de abajo (la sincronización de planillas sigue con el suyo). |
| `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` | secret | Activa la importación de carpetas de Google Drive (solo lectura, `drive.readonly`, un scope restringido; con su propio cliente OAuth, no el del login) y la sincronización programada de planillas (Automatizar → *Sincronizar datos desde Google Drive*), que pide su propio consentimiento solo para `drive.file`, con el selector de Google (Picker) adentro. Activá la **Google Picker API** en el mismo proyecto de Cloud. Redirección (ambos): `{SHAREOUT_BASE_URL}/v1/file-imports/oauth/google_drive/callback`. Requiere `CREDENTIALS_KEY`. Mientras la pantalla de consentimiento está en *Testing*, Google vence los refresh tokens a los 7 días y las sincronizaciones programadas se cortan; publicala para uso real. |
| `GOOGLE_DRIVE_FILE_CLIENT_ID` / `GOOGLE_DRIVE_FILE_CLIENT_SECRET` | secret | Opcional. Un cliente OAuth en un **proyecto de Cloud aparte** solo para la sincronización de planillas (por ejemplo un proyecto publicado que declara solo `drive.file`, mientras el de importación de carpetas sigue en Testing). Misma redirección; activá la Google Picker API en ese proyecto. No uses un segundo cliente en el mismo proyecto: Google revoca por proyecto, y ShareOut toma un cliente distinto como un proyecto distinto cuando una desconexión decide si revocar. Sin definir = usa `GOOGLE_DRIVE_CLIENT_ID`. |
| `MICROSOFT_FILES_CLIENT_ID` / `MICROSOFT_FILES_CLIENT_SECRET` / `MICROSOFT_FILES_TENANT` | secret / var | Activa la importación de OneDrive / SharePoint (delegados `Files.Read.All`, `Sites.Read.All`, `User.Read`, `offline_access`). Tenant por defecto `common`. Redirección: `{SHAREOUT_BASE_URL}/v1/file-imports/oauth/microsoft/callback`. |
| — | — | **El login con contraseña no necesita configuración.** Está siempre disponible y es como `/setup` crea el primer admin. |
| Binding `EMAIL` | binding | Habilita los códigos de un solo uso por email. Sin él, esos códigos solo llegan al log del worker. |
| `EMAIL_DEFAULT_FROM` | var | From cuando Email está bound. |
| `EMAIL_WEBHOOK_SECRET` | secret | Activa el webhook de rebotes y quejas (`/v1/webhooks/email-events`). Sin setear = responde `404` y los rebotes nunca se suprimen. Ver [Email → Entregabilidad](/es/self-host/email/#entregabilidad). |

## Google Drive compartiendo

Cada workspace tiene su propia cuenta de servicio de Google. Se comparte una carpeta de
Drive con ese email como Lector y ShareOut la lee como esa cuenta: un workspace solo puede
ver lo que se compartió con su propio email (lo hace cumplir Google). Una clave para la
instancia; las cuentas de cada workspace no tienen ninguna.

En un proyecto de Google Cloud que no tenga nada más (la clave puede suplantar a todas sus
cuentas de servicio):

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

- **¿No te deja crear la clave?** Las organizaciones creadas desde el 2024-05-03 aplican
  `iam.disableServiceAccountKeyCreation`; desactivalo solo en este proyecto.
- **Cuántos workspaces:** Google limita las cuentas de servicio por proyecto ("varía según
  el proyecto"). Mirá el tuyo con `gcloud quotas info list --service=iam.googleapis.com
  --project=$P` (*Service Account Count*) o en la consola, en las cuotas de IAM, y pedí más
  si hace falta. Un workspace que no puede tener su propia cuenta ve un error claro
  (`SHARE_EMAIL_LIMIT`); nunca recibe una compartida. El worker registra
  `Google service-account limit reached`.
- **Rotar:** creá una segunda clave en `shareout-drive-minter`, cargala con
  `wrangler secret put`, probá una importación y borrá la vieja. **Cortar todo:** borrá la clave.
- El cron horario borra la cuenta de los workspaces eliminados.

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
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_BUSINESS_NUMBER` | var / secret | El asistente en WhatsApp (Cloud API de Meta). Las cinco, o queda apagado. Ver [Asistente en WhatsApp → Para quien opera la instancia](/es/guides/whatsapp/#para-quien-opera-la-instancia). |
| `TELEGRAM_LOGIN_LINKS` | var | `1` = los links de artefactos en las respuestas del bot de Telegram inician la sesión del miembro con un toque. Necesita `TELEGRAM_BOT_TOKEN` y `/setdomain` en BotFather. Ver [Bot de Telegram](/es/guides/telegram-bot/). |
| `SUPPORT_ALERT_TELEGRAM_CHAT_ID` | var | Chat de Telegram que recibe las alertas del operador: tickets de soporte nuevos, builds que fallan, un proveedor de IA sin crédito, gasto diario de IA y crédito bajo del gateway. Necesita `TELEGRAM_BOT_TOKEN`. Ver [Proveedor de IA → Alertas](/es/self-host/ai/#alertas). |
| `AI_SPEND_ALERT_USD_PER_DAY` / `AI_CREDIT_ALERT_USD` / `BUILD_AGENT` / `BUILD_EFFORT` / `BUILD_MODEL` / `SCAN_MODEL` | var | Líneas de alerta de IA, el agente de build y la elección de modelos. Ver [Proveedor de IA → Todas las opciones de IA](/es/self-host/ai/#todas-las-opciones-de-ia). |
| `VERIFY_RUNS_PER_HOUR` | var | Verificaciones por usuario por hora UTC (`POST /v1/artifacts/{id}/verify`, MCP `verify_artifact`). Sin setear = 30. |
| `CUSTOM_DOMAINS_CNAME_TARGET` | var | Activa los dominios propios de los workspaces: el host al que los clientes apuntan su dominio con un CNAME. Solo = modo manual (ShareOut verifica un registro TXT `_shareout-verify`; vos ruteás cada host al Worker). Ver [Dominio propio → Para quien opera la instancia](/es/teams/custom-domain/#para-quien-opera-la-instancia). |
| `CF_CUSTOM_HOSTNAMES_TOKEN` / `CF_CUSTOM_HOSTNAMES_ZONE_ID` | secret / var | Opcional, junto con el destino del CNAME: Cloudflare for SaaS da de alta cada dominio propio y su certificado. Permiso del token: Zone → SSL and Certificates: Edit, en la zona SaaS. |
| `D1_READ_REPLICAS` | var | `1` = las queries de cada pedido pasan por una sesión de la API D1 Sessions, así una réplica de lectura cercana puede servir las lecturas (pedidos `GET`, `HEAD` y `OPTIONS`; cualquier otro arranca en la primaria). Activá antes la replicación de lectura de la base en Cloudflare. Un pedido que escribió devuelve un header `x-d1-bookmark` y una cookie `__d1b` para que la próxima lectura de quien llama sea al menos así de fresca. Sin setear = todas las queries van a la primaria. |
| `OPENAI_API_KEY` / `VERCEL_AI_GATEWAY` | secret | **La AI está apagada hasta setear una** — Crew, asistentes, editor AI, knowledge. Ver [Ops → Proveedores de AI](/es/self-host/ops/#proveedores-de-ai). |
| `CREDENTIALS_KEY` | secret | `openssl rand -hex 32`. Cifra las keys de AI por workspace y las credenciales de conectores; esos endpoints se niegan sin esto. |

## Desarrollo local

Copiá `shareout-app/.dev.vars.example` → `.dev.vars` y seteá al menos
`SESSION_SECRET`. Usá `/auth/dev?email=vos@ejemplo.com&redirect=/home` para una
sesión sin OAuth.
