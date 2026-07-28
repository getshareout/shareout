---
title: Autenticación
description: Cómo autenticar requests a la API de ShareOut.
---

import { Aside } from '@astrojs/starlight/components';

Los endpoints de escritura necesitan un token. El acceso de lectura a artifacts
públicos no.

## Bearer token

Enviá tu token en el header `Authorization`:

```bash
curl -H "Authorization: Bearer so_your_token_here" \
  "$ORIGIN/v1/artifacts"
```

Los tokens se ven como `so_…`. Mantenelos en secreto — cualquiera que tenga tu
token puede publicar como vos.

### Dónde guardarlo

El CLI y los scripts de ejemplo leen desde `~/.shareout/credentials`:

```json title="~/.shareout/credentials"
{
  "token": "so_your_token_here",
  "origin": "https://shareout.<tu-cuenta>.workers.dev"
}
```

`$ORIGIN` es ese campo `origin` (sin slash final).
## Tokens de Agente del workspace (cuentas de servicio)

Para un llamador no humano —el agente de IA de un cliente, un servicio backend o CI/CD—
usá un **token de Agente del workspace** (prefijo `sot_`) en lugar de un token personal
`so_`. Autentica como un **principal de servicio** headless acotado a un workspace, con
scopes de acción (`artifacts:read`, `artifacts:publish`, `data:read`, `data:write`), y se
revoca de forma independiente de cualquier empleado.

Creá uno como owner/admin del workspace y usalo igual que un token personal:

```bash
curl -X POST "$ORIGIN/v1/workspaces/{workspace_id}/agent-tokens" \
  -H "Authorization: Bearer so_admin_token" -H "Content-Type: application/json" \
  -d '{ "name": "CI bot", "scopes": ["artifacts:publish", "data:write"] }'
# → { "token": "sot_…", "shown_once": true, … }
```

Ver [API de Teams → Tokens de Agente](/es/teams/api/#tokens-de-agente-cuentas-de-servicio)
para listar y revocar. Un scope faltante devuelve `403 INSUFFICIENT_SCOPE`.

## Device login (CLI / agentes)

Para un usuario que **ya tiene cuenta en ShareOut** — sobre todo alguien **invitado
a un workspace por email** — `create-account` anónimo crea una cuenta headless nueva
en lugar de unirse a la real. **Device login** inicia sesión vía Google en el
navegador y devuelve un token `so_` al CLI.

```
CLI  → POST /v1/auth/device/start
     ← { device_code, user_code, verification_uri_complete, interval, expires_in }
Usuario → abre verification_uri_complete, continúa con Google
CLI  → POST /v1/auth/device/token { device_code }  (poll cada interval segundos)
     ← { status: "approved", token: "so_…", user_id, warn? }
CLI  → guardar token en ~/.shareout/credentials
```

- `device_code` es el secreto del CLI; `user_code` es el código corto del navegador.
  Nunca envíes `device_code` al usuario.
- Los códigos expiran en **10 minutos**. Hacé poll no más rápido que `interval` (5s).
  El token se entrega **una vez** — la fila pendiente se consume en el primer poll aprobado.
- Body opcional al iniciar: `{ "expected_email": "invitado@empresa.com" }`. Se pasa a
  Google como `login_hint` para preseleccionar la cuenta correcta, y emite un `warn`
  preciso si el usuario inicia sesión con otro email.
- **Fallback copiar/pegar:** la página de éxito del navegador muestra el token cuando
  el CLI no puede hacer poll.

```http
POST /v1/auth/device/start
Content-Type: application/json

{ "expected_email": "invitado@empresa.com" }
```

```http
POST /v1/auth/device/token
Content-Type: application/json

{ "device_code": "…" }
```

Los polls pendientes devuelven `{ "status": "pending", "interval": 5 }`. Los aprobados
devuelven `{ "status": "approved", "token": "so_…", "user_id": "usr_…", "warn"?: "…" }`.

## Cookies de sesión (navegador)

Los requests desde una sesión de navegador logueada también se aceptan vía
cookie, seteada por el flujo de inicio de sesión de Google:

- `shareout_session` — auth de Google
- `shareout_access` — auth por password / credenciales

Para llamadas server-to-server, preferí el bearer token.

## Cuentas vinculadas

Podés vincular varios inicios de sesión de Google a una identidad de ShareOut
(Configuración → Cuentas vinculadas). Después de vincular, los artifacts de
cualquier identidad vinculada cuentan como **tuyos** para propiedad, visibilidad
y acceso de edición — no necesitás invitación de colaborador aparte en páginas
que ya sos dueño con un mail vinculado.

<Aside type="caution" title="Cloudflare protection">
ShareOut corre detrás de Cloudflare. Los `requests` de Python pueden disparar un
bloqueo `1010`. Construí tu payload en Python y pasalo por pipe a `curl` — mirá
el [Quickstart](/es/start/quickstart/).
</Aside>

## Rate limits

| Endpoint | Límite |
| --- | --- |
| Publish | 60 / hora por usuario |
| Data API | 1000 / min por artifact |
| Email | 50 / día por usuario, 10 / día por artifact |
| CORS proxy | 100 / min por artifact |

Superar un límite devuelve `429` con código `RATE_LIMITED`.
