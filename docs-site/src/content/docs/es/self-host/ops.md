---
title: Ops self-host
description: Upgrades, backups y health checks para un Worker ShareOut self-hosted.
---

## Administrar la instancia

`/admin` es el portal del dueño de la instancia. El acceso sale de cualquiera de:

| Fuente | Uso |
|--------|-----|
| `INSTANCE_ADMIN_EMAILS` | Emails separados por coma. **El camino self-host** — sin editar código, sin fork. |
| `SETUP_ADMIN_EMAIL` | El primer admin, para que no se quede afuera. |
| `superadmin-recipients.json` | Viene vacío. Opcional si preferís un roster commiteado (y ahí viven los overrides de chat de Telegram). |

Mientras *nada* nombre un admin, el usuario más antiguo cuenta como tal para que una
instancia nueva nunca quede bloqueada. Nombrar a alguien termina ese fallback.

### Dar de alta el workspace de un cliente

Toda cuenta nueva de cliente pasa por una sola llamada. Crea el workspace con su slug
(que también es su subdominio) y su idioma, aplica branding y políticas por defecto,
crea carpetas iniciales, invita a los primeros admins con el email de invitación de
siempre y guarda los conectores de datos que le pases — en un paso, típicamente
bastante menos de un minuto de trabajo una vez escrito el spec.

En el portal: **`/admin` → Instance → Provision a workspace**. Desde un archivo, con el
token personal de un admin de instancia (`so_`; los tokens de Agente `sot_` se
rechazan):

```bash
cd shareout-app
cp scripts/provision-workspace.example.yaml acme.yaml   # editalo
SHAREOUT_ORIGIN=https://shareout.example.com \
SHAREOUT_ADMIN_TOKEN=so_... \
ACME_API_KEY=... \
node scripts/provision-workspace.mjs acme.yaml
```

El spec (YAML o JSON):

| Campo | Qué es |
|-------|--------|
| `name`, `slug` | Obligatorios. El slug es el subdominio: 2–63 minúsculas, dígitos y guiones; los nombres reservados (`www`, `api`, `admin`, `app`, …) se rechazan. |
| `locale` | `es` o `en` — el idioma de invitaciones, emails y workspace. |
| `admins` | Obligatorio. El primero es el dueño (o usá `owner_email`). Nadie necesita haber entrado todavía. |
| `subdomain` | `true` prende `<slug>.<tu instancia>`. |
| `branding` | `accent_color` (`#RRGGBB`), `hide_footer`, `logo` (`{ url }` bajado por https, o `logo_file` al lado del spec). PNG/JPG/WEBP/SVG, máx. 512 KB. |
| `policy` | `allowed_domains`, `allowed_emails`, `external_sharing`, `guest_comments` (en las carpetas iniciales), `knowledge`, `features` (cualquier clave de `GET /v1/admin/features`). |
| `folders` | Carpetas iniciales, p. ej. `[Clientes, Proveedores, Reportes]`. |
| `connectors` | El mismo body que `POST /v1/workspaces/{id}/connections`. Escribí los secretos como `${ENV_VAR}`; la CLI los completa desde el entorno, así nunca quedan en el archivo. |
| `templates` | Instala una vez cada plantilla de la biblioteca de la instancia con esa etiqueta (al volver a correr, saltea las que el workspace ya tiene). `pending` si ninguna la lleva. |
| `custom_domain` | Asocia el dominio al workspace y lo deja como principal cuando está activo. `pending` con los registros DNS hasta que se verifique, o mientras la instancia no tenga dominios propios activados; volvé a correr el spec para chequear. |
| `if_exists` | `match` (default) adopta un slug existente solo si coincide el nombre; `update` lo adopta y renombra; `fail` lo rechaza. |

**Se puede volver a correr.** La corrida se identifica por el slug: completa lo que
falta y marca el resto `unchanged`. Nunca crea un segundo workspace, carpeta,
membresía o conector, nunca reenvía una invitación vigente (pasá
`resend_invites: true` para hacerlo) y nunca pisa una credencial guardada — esas se
rotan en el workspace.

**Cómo leer el resultado.** La CLI imprime, y la API devuelve, los links del workspace,
el estado de la invitación de cada admin (`invited`, `already_invited`, `active`,
`failed`; con el link de ingreso cuando el email no salió), una línea por paso
(`created`, `updated`, `unchanged`, `skipped`, `pending`, `failed`) y los próximos
pasos. Si un paso falla — una URL de logo que da 404, un conector que el proveedor
rechaza — los demás igual corren, la API responde `207` y la CLI sale con `2`.
Corregí el spec y corrélo de nuevo.

Los errores de validación vuelven antes de escribir nada, en el formato estándar
(`code`, `param`, `hint`): `INVALID_SLUG`, `SLUG_RESERVED`, `SLUG_TAKEN` (409, otro
workspace ya tiene ese slug), `INVALID_EMAIL`, `ADMIN_OUTSIDE_POLICY`,
`PUBLIC_EMAIL_DOMAIN`, `INVALID_FEATURE`, `INVALID_COLOR`, `INVALID_LOGO`,
`LOGO_TOO_LARGE`, `LOGO_INVALID_CONTENT_TYPE`.

Cada paso deja una fila en el audit log (`workspace.provision.<paso>`, más una
`workspace.provision` por la corrida) con el email del admin que actuó. Los valores de
las credenciales nunca se devuelven, ni se loguean, ni se auditan.

### Crear un workspace para un equipo

El dueño no necesita haber entrado todavía — cae adentro en su primer login.

```bash
curl -sS -X POST "$ORIGIN/v1/admin/workspaces" \
  -H "Cookie: $ADMIN_SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"Marketing","owner_email":"ana@acme.test"}'
```

### Nombrar un admin en cualquier workspace

No hace falta ser miembro.

```bash
curl -sS -X POST "$ORIGIN/v1/admin/workspaces/$WORKSPACE_ID/members" \
  -H "Cookie: $ADMIN_SESSION" -H 'Content-Type: application/json' \
  -d '{"email":"beto@acme.test","role":"admin"}'
```

Roles: `owner`, `admin`, `member`. Ambas llamadas quedan en el audit log del
workspace con el email del admin que actuó.

### Ver para qué está configurada la instancia

`GET /v1/admin/instance` (admin de instancia) lo responde en un solo documento — y,
más útil, lista qué falta y qué deshabilita cada hueco:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Cookie: $ADMIN_SESSION" | jq .gaps
```

No devuelve secretos, solo si cada uno está presente. Un array `gaps` vacío es la
señal de que la instancia está completa.

### Proveedores de AI

La AI está **apagada hasta que pongas una key**. Todas las superficies de AI degradan
en silencio en lugar de fallar, por eso conviene mirar `gaps` y no esperar a notarlo.

| Nivel | Cómo | Alcance |
|-------|------|---------|
| Instancia | `npx wrangler secret put OPENAI_API_KEY` (o `VERCEL_AI_GATEWAY`) | Todos los workspaces, lo pagás vos |
| Workspace | `PUT /v1/workspaces/{id}/llm` `{provider, apiKey}` | Solo ese workspace, lo paga él |

Las keys por workspace se guardan cifradas y necesitan `CREDENTIALS_KEY` — el endpoint
se niega sin eso en lugar de guardar algo que no puede proteger. El mismo secret cifra
las credenciales de conectores.

### Búsqueda multilingüe de Knowledge

Los índices originales de Knowledge (`KNOWLEDGE_VECTORS`, `VECTORIZE`) usan un modelo solo
en inglés: una pregunta en español casi nunca encuentra por significado un documento en
inglés. El índice multilingüe, `KNOWLEDGE_VECTORS_V2`, usa `@cf/baai/bge-m3` (o
`@cf/qwen/qwen3-embedding-0.6b` con `KNOWLEDGE_EMBED_MODEL`) y un namespace por workspace.
Se activa por pasos, y cada paso se puede deshacer:

1. **Creá** el índice y sus índices de metadata, en este orden:

   ```bash
   npx wrangler vectorize create shareout-knowledge-v2 --dimensions=1024 --metric=cosine
   npx wrangler vectorize create-metadata-index shareout-knowledge-v2 --property-name=source_kind --type=string
   npx wrangler vectorize create-metadata-index shareout-knowledge-v2 --property-name=source_id --type=string
   npx wrangler vectorize create-metadata-index shareout-knowledge-v2 --property-name=embed_model --type=string
   ```

2. **Conectalo** (descomentá `KNOWLEDGE_VECTORS_V2` en `wrangler.toml`) y deployá. Desde ahí
   los pasajes, notas y páginas nuevos o cambiados se escriben en los dos índices; las
   búsquedas siguen leyendo los viejos.
3. **Backfill** de lo que ya existe, desde el texto guardado (no se vuelve a bajar nada). Un
   Workflow con pausas por workspace; repetí con `after=<next>` hasta que `next` sea `null`:

   ```bash
   curl -sS -X POST "$ORIGIN/v1/admin/knowledge/vectors/backfill?limit=10" \
     -H "Authorization: Bearer $SHAREOUT_ADMIN_TOKEN"
   ```

   Un solo workspace: `POST /v1/workspaces/{id}/knowledge/vectors/backfill`. Progreso:
   `GET /v1/workspaces/{id}/knowledge/vectors` — un workspace está cubierto cuando
   `workspace.chunks.missing` es 0 y `workspace.passes` nombra el modelo. Repetirlo solo
   embebe lo que falta; la pasada de Knowledge de las 03:00 UTC también arranca algunos para
   workspaces con huecos. Se mide como el ingest (`knowledge_embedding`, source
   `vectors-backfill`): bge-m3 cuesta USD 0,012 por millón de tokens.
4. **Pasá las búsquedas**: `KNOWLEDGE_VECTORS_READ = "v2"` y deployá. Cada workspace lee el
   índice nuevo cuando está cubierto y el viejo mientras tanto; una respuesta vacía del nuevo
   también vuelve al viejo. Para volver atrás, sacá la variable.

Cambiar `KNOWLEDGE_EMBED_MODEL` más adelante es igual: deploy, backfill, y las lecturas siguen
en el índice viejo hasta que el modelo nuevo cubre cada workspace. Si recreás el índice, hacé
el backfill con `{"reset": true}` (por workspace) o `&reset=1` (admin) para escribir todo de nuevo.

## Upgrades

1. Traé el último release público (o re-sincronizá el export si espejás en privado).
2. Desde `shareout-app/`:

   ```bash
   npm ci
   npm run db:migrate:prod          # aplicar migraciones D1 nuevas
   npm run deploy                   # o deploy:with-migrations
   ```

3. Smoke: abrí `/home`, publicá con `npm run smoke:hello` si tenés un token a mano.

Siempre aplicá migraciones D1 **antes** de depender del schema nuevo en un deploy.

## Backups

| Store | Sugerencia |
|-------|------------|
| D1 | `wrangler d1 export` periódico (o backups de Cloudflare cuando existan) |
| R2 | Versionado del bucket / sync a un segundo bucket |
| Durable Objects | Export a nivel app de tablas críticas; los DOs no son un dump SQL único |

Probá un restore en un worker de staging antes de necesitarlo.

## Observabilidad

- Logs del worker: `npx wrangler tail`
- En producto: Admin → Health (si estás firmado como admin), si tu build lo tiene
- No hay canal de notificación de super-admin — usá `/admin?view=health` y los logs del Worker

### Server-Timing

Los requests con sesión iniciada a `/home`, `/v1/home/*`, `/v1/artifacts` y
`/v1/artifacts/*` responden con un header `Server-Timing` que desglosa el request por
fase. Los requests anónimos no reciben el header. Los valores llevan solo nombres de
fase, conteos y milisegundos — ni ids ni datos.

```http
Server-Timing: auth;dur=12, host;dur=4, d1;desc="9 calls, 3 waves";dur=41, kv;desc="1 calls, 1 waves";dur=3, app;dur=63
```

| Entrada | Significado |
| --- | --- |
| `auth` | Resolver la sesión o el token de API |
| `host` | Buscar el workspace de un subdominio |
| `render` | Armar el documento de `/home` |
| `d1` | Sentencias D1: `calls`, `waves` (rondas de queries que corrieron una después de otra — el número que más pesa en la latencia) y ms ocupados |
| `kv` | Lecturas de KV, mismo formato |
| `app` | Tiempo total en el Worker |

Para leerlo, abrí DevTools → **Network**, elegí el request y abrí la pestaña **Timing**:
Chrome y Edge listan las entradas en *Server Timing*. O desde una terminal:

```bash
curl -sS -o /dev/null -D - "$ORIGIN/v1/home/activity-feed" -H "Cookie: $SESSION" | grep -i server-timing
```

`/home` hace streaming del HTML, así que su header cubre solo el trabajo previo al primer
byte. El desglose completo, con las queries y el render del documento, va al final como
comentario HTML: `<!-- server-timing: … -->` (mirá el código fuente y bajá hasta el final).

Los relojes de Workers solo avanzan con I/O, así que una fase solo de CPU como `render`
puede marcar cerca de 0 en producción.

## Seguridad básica (checklist pre-público)

Antes de exponer una instancia a internet:

- Rotá cualquier secret que haya filtrado a un gist o chat
- Mantené `SESSION_SECRET` largo y único por instancia
- Preferí artefactos privados + auth hasta entender open visibility
- Revisá WAF / bot settings de Cloudflare en tu zona
- Reportá vulns del producto vía [SECURITY.md](https://github.com/getshareout/shareout/blob/main/SECURITY.md)

Un threat-model más profundo debería aterrizar antes de un anuncio OSS amplio —
tratá esta página como higiene de operador, no como informe de auditoría.
