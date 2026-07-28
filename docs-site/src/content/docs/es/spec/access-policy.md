---
title: Política de acceso (nivel de fila)
description: Filtrado de filas por viewer aplicado en el servidor — cómo ShareOut resuelve un email verificado al slice exacto de datos que ese viewer puede ver.
---

La política de acceso a nivel de fila te permite compartir **un** artifact externamente y que cada viewer vea **solo su propio slice** de los datos — cada cliente su `company_id`, cada prospecto su `pitch`, cada responsable de región su `region`. El filtrado se aplica del lado del servidor dentro del Cloudflare Worker, después de identificar al viewer y antes de devolver cualquier fila. El viewer no puede evitarlo ni ampliarlo.

Para una explicación no técnica sobre visibilidad y compartición, ver [Quién ve qué](/es/everyone/who-sees-what/).

## Por qué el enforcement tiene que ser server-side

Un artifact de ShareOut corre en el browser del viewer y es completamente inspeccionable — puede leer el JS, abrir devtools y llamar directamente a los endpoints `/v1/data/…` con cualquier filtro que quiera. Un filtro escrito en el código de tu página (`sdk.table('sales').find({ company_id: 1 })`) es cosmético. La política de acceso corre dentro del Worker; el viewer no puede influir en ella.

## Cuándo usarla

| Objetivo | ¿Usar política? |
|----------|----------------|
| Un dashboard compartido con múltiples clientes externos, cada uno viendo solo sus filas | Sí |
| Un pitch deck donde cada prospecto ve solo sus propios números | Sí |
| Herramienta interna donde todos los colaboradores deben ver todo | No — usá [colaboradores](/es/everyone/collaborators/) |
| Ocultar qué otros tenants existen a viewers sin coincidencia | Sí — configurá `default: "deny"` |
| Contenido secreto por viewer dentro del HTML | No es posible — el contenido secreto debe llegar por la capa de datos |

## Flujo de una request

```
Autor                               Viewer
─────                               ──────
1. Publica el artifact              3. Abre la URL privada del artifact
   visibility: private                 → se loguea con Google o código OTP
   auth_method: google                 → el Worker tiene el email VERIFICADO
   share_with: [emails]
   access_policy: { … }            4. La página llama sdk.table('sales').find()
                                       → POST /v1/data/{id}/tables/sales/query
2. Política guardada server-side    5. Worker resuelve email/dominio → scope
   (nunca leída del HTML)              ejecuta: WHERE <filtro cliente>
                                               AND company_id IN (…)
                                    6. Solo se devuelven las filas en scope.
```

Los owners y colaboradores con rol editor bypasean la política y ven todos los datos (para autoría y QA). La política aplica solo a colaboradores con rol viewer y sign-ins externos.

Usá [`sdk.me()`](/es/sdk/overview/#identidad-del-viewer) en tu artifact para ramificar la
UI por rol del viewer (por ejemplo, panel admin para `canEdit`, vista cliente read-only
para el resto). La aplicación server-side no cambia — nunca confíes solo en checks del
cliente.

## Schema de la política

Adjuntá un objeto `access_policy` al publicar. Se guarda server-side y puede actualizarse sin re-publicar el HTML.

```json
{
  "version": 1,
  "field": "company_id",
  "default": "deny",
  "rules": [
    { "match": { "email": "buyer@acme.com" }, "values": [1] },
    { "match": { "domain": "acme.com" },       "values": [1, 2] },
    { "match": { "domain": "globex.com" },     "values": [3] }
  ]
}
```

| Key | Tipo | Descripción |
|-----|------|-------------|
| `version` | `1` | Versión del schema. Debe ser `1`. |
| `field` | string | El campo de la fila a filtrar. Debe coincidir con la key JSON almacenada en cada fila (p. ej. `company_id`, `tenant`, `region`). |
| `default` | `"deny"` \| `"allow"` | Resultado para un viewer que no coincide con ninguna regla. `"deny"` → cero filas (recomendado). `"allow"` → sin filtro. |
| `rules` | array | Lista ordenada de reglas match→values. Un viewer acumula la **unión** de `values` de todas las reglas que lo coinciden. |
| `rules[].match.email` | string | Coincidencia exacta de email, case-insensitive. |
| `rules[].match.domain` | string | Coincidencia de dominio de email (`buyer@acme.com` → dominio `acme.com`). Cada regla debe tener al menos uno de `email` o `domain`. |
| `rules[].values` | array de string\|number | Valores permitidos de `field` para un viewer coincidente. No puede estar vacío. |

### Resolución

La política del ejemplo anterior:

| Viewer | Rol | Scope aplicado |
|--------|-----|----------------|
| `buyer@acme.com` | viewer | `company_id IN (1, 2)` — regla email `[1]` ∪ regla dominio `[1, 2]` |
| `ceo@acme.com` | viewer | `company_id IN (1, 2)` — solo regla dominio |
| `ops@globex.com` | viewer | `company_id IN (3)` |
| `someone@stranger.com` | viewer | sin filas (`default: deny`, sin coincidencia) |
| anónimo | — | sin filas (`default: deny`) |
| owner / editor | owner/editor | todas las filas (bypass de política) |

El scope siempre se combina con **AND** con lo que consulta la página — solo estrecha, nunca amplía. Si la página envía `find({ company_id: 99 })` pero el scope del viewer es `[1, 2]`, el resultado es vacío.

## Ejemplo completo

Un proveedor SaaS comparte un único dashboard de ventas. Dos clientes deben ver solo sus propias filas.

### Datos (tabla multi-tenant)

```json
[
  { "company_id": 1, "month": "2026-05", "revenue": 42000 },
  { "company_id": 2, "month": "2026-05", "revenue": 18000 },
  { "company_id": 3, "month": "2026-05", "revenue": 91000 }
]
```

### HTML del artifact

La página consulta sin ningún filtro de tenant — el servidor estrecha automáticamente:

```html
<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
  <script src="https://shareout.site/sdk/shareout.js"></script>
  <script type="shareout/manifest">
  {
    "version": "2.0",
    "sources": {
      "tables": {
        "sales": { "schema": [
          { "name": "company_id", "type": "number" },
          { "name": "month",      "type": "string" },
          { "name": "revenue",    "type": "number" }
        ] }
      }
    }
  }
  </script>
</head>
<body>
  <script>
    const sdk = new ShareOut();
    // Sin filtro de tenant del lado cliente — el servidor lo aplica.
    const rows = await sdk.table('sales').find().sort({ month: -1 }).toArray();
    // rows ya contiene SOLO las filas del viewer logueado.
  </script>
</body>
</html>
```

### Publicar

```bash
TOKEN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['token'])")

python3 -c 'import json; print(json.dumps({
  "name": "customer-sales",
  "files": [{"path": "index.html", "content": open("index.html").read(), "mime": "text/html"}],
  "visibility": "private",
  "auth_method": "google",
  "share_with": ["buyer@acme.com", "ops@globex.com"],
  "access_policy": {
    "version": 1, "field": "company_id", "default": "deny",
    "rules": [
      {"match": {"domain": "acme.com"},   "values": [1, 2]},
      {"match": {"domain": "globex.com"}, "values": [3]}
    ]
  }
}))' | curl -sS -X POST 'https://shareout.site/v1/publish' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @-
```

## Actualizar y eliminar la política

**Actualizar sin re-publicar el HTML** — `PATCH` del artifact:

```http
PATCH /v1/artifacts/{artifact_id}
Authorization: Bearer {token}
Content-Type: application/json

{ "access_policy": { "version": 1, "field": "company_id", "default": "deny", "rules": [ … ] } }
```

**Eliminar la política** (todos los viewers ven todo nuevamente):

```http
PATCH /v1/artifacts/{artifact_id}
Content-Type: application/json

{ "access_policy": null }
```

:::caution[Re-publicar preserva la política]
Publicar HTML sin el campo `access_policy` deja la política existente intacta — las actualizaciones de contenido rutinarias nunca eliminan tu regla de seguridad por accidente. Para remover una política, enviá `access_policy: null` via PATCH explícitamente.
:::

Las políticas inválidas se rechazan al escribir con `400 INVALID_ACCESS_POLICY` y un mensaje que indica el campo con error.

## Autenticación del viewer

La política necesita una identidad verificada, así que el artifact debe requerir login:

- `visibility: "private"` — los visitantes anónimos no tienen identidad y, bajo `default: "deny"`, no obtienen datos.
- `auth_method: "google"` — los viewers se loguean con Google OAuth o un código de 6 dígitos por email; el Worker recibe su email verificado.
- `share_with: […]` — el gate de acceso (quién puede abrir el artifact). La `access_policy` es el filtro de filas (qué ve cada viewer permitido). Son dos capas independientes.

Un viewer debe pasar ambos controles: estar en `share_with` (o pertenecer al workspace) **y** coincidir con una regla de la política para recibir filas.

## Data Platform (Snowflake / BigQuery)

Para dashboards respaldados por warehouse, aplicá el scope escribiendo el placeholder `:viewer_scope` en la query. El servidor sustituye los valores permitidos del viewer antes de ejecutar:

```sql
SELECT month, revenue
FROM sales
WHERE company_id IN (:viewer_scope)
```

- Un viewer con scope cuya query omite `:viewer_scope` recibe `403 SCOPE_REQUIRED` — fail-closed.
- Un scope vacío (viewer denegado) resuelve `:viewer_scope` a `NULL`, por lo que `IN (NULL)` no devuelve nada.
- El modo de ejecución directa está bloqueado para viewers con scope (le pasaría credenciales al browser).
- El cache de plataforma está segmentado por scope — el resultado filtrado de un viewer nunca se sirve a otro.
- Los proveedores no-SQL (Google Sheets, Analytics, Shopify) no tienen mecanismo de `:viewer_scope`; los viewers con scope quedan bloqueados.

## Cobertura de backends

| Backend | Bajo una política de acceso, un viewer con scope… |
|---------|---------------------------------------------------|
| `sdk.table()` | ve solo filas en scope; lecturas y escrituras filtradas; `findById` fuera de scope → 404 |
| Data Platform — SQL (Snowflake, BigQuery) | debe incluir `:viewer_scope`; si no, `403 SCOPE_REQUIRED` |
| Data Platform — no-SQL (Sheets, GA, Shopify) | bloqueado (`403 SCOPE_REQUIRED`) |
| `sdk.json` | bloqueado (`403`) — solo owner/editor bajo una política |
| `sdk.blobs`, `sdk.realtime`, `sdk.comments` | no tienen scope — no almacenés datos secretos por tenant ahí |

## Límites de seguridad

Lo que la política garantiza:

- Todos los paths de lectura y escritura de `sdk.table()` están filtrados — `find`, `count`, `distinct`, `findById`, `update`, `delete`. Ningún path bypasea la cláusula de scope.
- El scope se combina con AND con el filtro del cliente; solo puede estrechar.
- El SQL de Data Platform es fail-closed: si falta `:viewer_scope` para un viewer con scope → `403`.
- El bypass de owner/editor se determina a partir de la sesión verificada por el servidor, no de nada que el cliente envíe.

Lo que **no** protege:

- **Cualquier cosa hardcodeada en el HTML/JS publicado** es visible para todo viewer autorizado. El contenido secreto por viewer debe llegar por `sdk.table()`, clave por el campo de la política.
- **La coincidencia por dominio confía en el dominio del email.** No uses reglas de `domain` para dominios compartidos de consumidores (`gmail.com`, `outlook.com`) — usá reglas de `email` explícitas.
- **`sdk.blobs`, `sdk.realtime` y `sdk.comments`** no tienen scope. No almacenés datos secretos por tenant ahí.

## Testing local

Corré el worker localmente y simulá distintos viewers con el helper `/auth/dev`:

```bash
open "http://localhost:55162/auth/dev?email=buyer@acme.com&redirect=/a/customer-sales"
# En otro perfil del browser:
open "http://localhost:55162/auth/dev?email=ops@globex.com&redirect=/a/customer-sales"
```

Prueba de leak — confirmá que el servidor estrecha incluso cuando el cliente pide una fila fuera de scope:

```bash
curl -sS -X POST 'http://localhost:55162/v1/data/{artifact_id}/tables/sales/query' \
  -H 'Content-Type: application/json' --cookie 'shareout_session=…' \
  --data '{"filter": {"company_id": 3}}'   # como viewer de Acme → devuelve []
```

## Troubleshooting

| Síntoma | Causa probable |
|---------|----------------|
| El viewer no ve filas | Ninguna regla coincide con su email/dominio y `default` es `deny`; o las filas no tienen el `field`; o el nombre de `field` en la política difiere de la key JSON en las filas. |
| El viewer ve todas las filas | `default: "allow"`; o es owner/editor (bypass); o el artifact no es `private`. |
| El cambio de política no tiene efecto | El metadata del artifact se cachea ~5 min. Publicar y PATCH limpian el cache automáticamente. |
| `400 INVALID_ACCESS_POLICY` al publicar | Política malformada — el mensaje indica el campo con error. |
| Re-publicar "perdió" mi política | No la perdió. Omitir `access_policy` la preserva; enviá `access_policy: null` via PATCH para eliminarla. |

## Checklist

- [ ] Cada fila tiene el campo de tenant (p. ej. `company_id` en todas las filas).
- [ ] El artifact tiene `visibility: "private"`, `auth_method: "google"`.
- [ ] `share_with` lista todos los emails de viewers (el gate de acceso).
- [ ] `access_policy.field` coincide exactamente con la key JSON de las filas.
- [ ] `default: "deny"` salvo que viewers sin coincidencia deban ver todo.
- [ ] Ningún dato secreto por viewer hardcodeado en el HTML.
- [ ] Probado como dos viewers distintos y como owner; ejecutada prueba de leak.
