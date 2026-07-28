---
title: Publicar artifacts
description: Creá, actualizá, versioná y compartí artifacts.
---

import { Aside } from '@astrojs/starlight/components';

Un artifact es un bundle versionado de archivos servido en una URL en vivo. Publicar
el mismo `slug` de nuevo crea una nueva versión — las anteriores siguen accesibles.

## Publicar

`POST /v1/publish` con tus archivos:

```json
{
  "name": "My App",
  "slug": "my-app",
  "entrypoint": "index.html",
  "visibility": "public",
  "files": [
    { "path": "index.html", "content": "<!DOCTYPE html>…", "mime": "text/html", "encoding": "utf8" }
  ]
}
```

Omití el `slug` y ShareOut genera uno. Mirá el schema completo en la
[referencia de la API](/api/operations/publishartifact/).

## URLs para compartir

La respuesta de publish incluye un objeto `deployment` con las URLs en vivo:

| Campo | Uso |
| --- | --- |
| `deployment.subdomain_url` | **Link para compartir en artifacts de workspace** — `https://{workspace}.shareout.site/{slug}/` |
| `deployment.url` | Link para artifacts **personales** (`https://shareout.site/a/{slug}/`); también la clave de routing interna para artifacts de workspace |
| `deployment.slug` | Slug de routing globalmente único (puede diferir del slug humano que enviaste) |
| `deployment.mobile_url` | Entrypoint mobile cuando hay `mobile_html` |

Para artifacts de **workspace**, mostrá `deployment.subdomain_url` a los usuarios — no la
URL apex `/a/{routing-slug}/`. El slug apex es una clave de routing interna que puede
llevar sufijo hash si hay colisión entre workspaces; el subdominio y las URLs con
namespace mantienen el slug humano limpio. Usá `deployment.url` solo para links de
máquina (embeds, manifests, KV).

## Editor readiness

Las publicaciones HTML devuelven un perfil **advisory** `editor_readiness` — cuánto puede
hacer el editor visual con el artifact. La publicación **nunca se bloquea** por gaps; la
página queda en vivo igual.

```json
{
  "editor_readiness": {
    "manifest": "valid",
    "outline": true,
    "counts": { "pages": 3, "bindings": 12, "templates": 1 },
    "summary": { "errors": 0, "warnings": 1, "infos": 0 },
    "findings": [
      {
        "rule": "binding-undeclared",
        "level": "warning",
        "message": "Binding \"json:revenue\" references undeclared json \"revenue\"",
        "suggestion": "Declare \"revenue\" in the manifest sources",
        "disables": "inline editing and formatting of this value"
      }
    ]
  }
}
```

El campo `disables` de cada finding nombra qué función del estudio cuesta ese gap. Ausente
en artifacts no-HTML. Los findings pueden incluir una `category` — p. ej. `provenance`
advierte cuando una fuente en vivo no tiene `query`/`description` o cuando los
gráficos carecen de `data-shareout-source` / vínculos en `feeds`. Ver
[Procedencia de datos](/es/guides/data-provenance/).

Mirá el [resumen de la spec](/es/spec/overview/) y el
[editor visual](/es/spec/editor/) para el checklist completo.

## Visibilidad

| Valor | Quién puede ver |
| --- | --- |
| `private` | Solo colaboradores con `viewer`+ |
| `workspace` | Cualquier miembro del workspace del artifact |
| `public` | Cualquiera en internet con el enlace; descubrible |

(`unlisted` es un alias legacy retirado, aún aceptado en la API y tratado como `public`.)

### Artifacts públicos

La visibilidad `public` activa reglas adicionales:

**Revisión de seguridad.** Al publicar o cambiar a visibilidad abierta, ShareOut
ejecuta un control automático del HTML. Si no puede aprobar al instante, el artifact
queda **privado** con `moderation_status: "pending"` y un objeto `moderation` al
publicar (o `code: "MODERATION_HELD"` + `reason` en PATCH) — pero ShareOut **revisa
los holds pendientes automáticamente** (cada hora) y restaura la visibilidad pública
solicitada cuando se libera; la mayoría de los casos se resuelven en una hora sin acción.

Los owners ven badges **Under review** / **Blocked** en las tarjetas de Home y un banner
en el inspector mientras dura el hold. Los visitantes que abren una URL pública en hold
ven una página dedicada de revisión (no el contenido del artifact). Al liberarse el hold,
el owner recibe notificación en la campana y por email.

**Scripts y CDNs externos.** En artifacts `public` la Content-Security-Policy
del sandbox permite scripts, estilos y fuentes desde una amplia lista de CDNs
reputados — jsDelivr, unpkg, cdnjs, esm.sh, Skypack, librerías de Google, la Tailwind
Play CDN (`cdn.tailwindcss.com`), jQuery, D3, Plotly, Highcharts, DataTables, Bootstrap
y más — que cubre la mayoría de las librerías. Un CDN **fuera** de la lista queda
bloqueado y su `<script>` no cargará. Si tu artifact carga un CDN no permitido, al
intentar hacerlo público se **rechaza**: queda privado y recibís un
mensaje con el host problemático.

**Los artifacts privados no tienen esa restricción.** Un artifact `private` puede
cargar scripts, estilos y fuentes desde **cualquier** origen HTTPS. Para un CDN de
nicho o propio, dejá el artifact **privado** y agregá colaboradores uno a uno
(Configuración → Compartir): tienen acceso completo y vos conservás el uso libre de
CDNs. Alternativa: alojá la librería como archivo dentro del artifact, o cambiá a un
CDN permitido.

**Visitantes anónimos son de solo lectura por defecto.** En artifacts públicos, los
visitantes anónimos no pueden escribir en json/tablas/blobs/datasets, enviar email,
usar el chat IA ni colaborar en tiempo real salvo que el dueño habilite cada
capacidad con `allow_anon_write`, `allow_anon_email`, `allow_anon_agent` o
`allow_anon_collab` (todos `false` por defecto).

**Badge.** Apagado por defecto. Poné `ARTIFACT_BADGE=1` en el Worker para agregar
un badge "Made with ShareOut" con enlace Report a los artifacts públicos.

**Cuota de almacenamiento.** Publicar verifica el total de bytes del dueño contra
`STORAGE_QUOTA_BYTES`; superarlo devuelve `413 STORAGE_LIMIT_EXCEEDED`. Sin setear
o en `0` es ilimitado, el default.

<Aside type="tip">
La visibilidad abierta (pública) está activa salvo que la instancia setee
`OPEN_VISIBILITY_DISABLED`. Donde está apagada, `POST /v1/publish` y
`PATCH /v1/artifacts/{id}` devuelven un `notice` (publicar) o `VISIBILITY_HELD`
(actualizar) en lugar de hacer downgrade silencioso.
Ver [Política de artifacts públicos](/es/public-artifacts/overview/#quien-puede-publicar-publicamente).
</Aside>

### Gobernanza de publicación del workspace

Los owners/admins pueden controlar la visibilidad abierta con una política por
workspace (`allow` / `prohibit` / `require_approval`). Por defecto es `allow`.
Mirá [Política de artifacts públicos](/es/public-artifacts/overview/) para el
contexto completo.

**Configurar (admin/owner):**

```http
GET  /v1/workspaces/{id}/publish-policy
PATCH /v1/workspaces/{id}/publish-policy
```

```json
{ "policy": "require_approval", "approvals_required": 2 }
```

`approvals_required` va de `1` a `10` cuando la política es `require_approval`.

**Cuando un miembro publica o cambia visibilidad a abierto**, corre el gate antes
de la moderación de plataforma:

| Política | Comportamiento |
| --- | --- |
| `prohibit` | Visibilidad forzada a `workspace`; la respuesta incluye `notice`. |
| `require_approval` | Visibilidad forzada a `workspace`; la respuesta incluye `notice` y `approval_required`. |

```json
{
  "deployment": { "url": "…" },
  "notice": "Tu workspace requiere aprobación para publicar en público. Quedó visible para tu workspace — pedí aprobación a 2 compañero(s).",
  "approval_required": { "required": 2, "artifact_id": "art_abc123" }
}
```

**Pedir aprobación** (el solicitante nombra exactamente N miembros del workspace, no a sí mismo):

```http
POST /v1/artifacts/{id}/publish-approval
{ "visibility": "public", "approver_ids": ["usr_a", "usr_b"] }
```

**Aprobar o rechazar** (cada aprobador nominado):

```http
POST /v1/artifacts/{id}/publish-approval/{requestId}/decision
{ "decision": "approve" }
```

**Listar solicitudes pendientes** (cualquier miembro del workspace):

```http
GET /v1/workspaces/{id}/publish-approvals?status=pending
```

Cuando todos los aprobadores nominados aprueban, la visibilidad cambia al nivel
pedido y corre la revisión de seguridad automática. Cualquier rechazo cancela la
solicitud. La aprobación es por hash de contenido — republicar sin cambios no
requiere una nueva ronda.

## Colaboradores

Agregá gente por email con un rol:

```bash
curl -X POST https://shareout.site/v1/artifacts/art_abc123/collaborators \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "emails": ["teammate@example.com"], "role": "editor" }'
```

| Acción | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Ver | ✓ | ✓ | ✓ |
| Editar y publicar | ✓ | ✓ | ✗ |
| Gestionar colaboradores | ✓ | ✓ | ✗ |
| Eliminar | ✓ | ✗ | ✗ |
| Transferir propiedad | ✓ | ✗ | ✗ |

## Previews de links

Configurá `og:title`, `og:description` y `og:image` en el `<head>` de tu entrypoint y
ShareOut los sirve para los unfurls de Slack, WhatsApp e iMessage. Sobrescribilos por
artifact con `PATCH /v1/artifacts/{id}` (`social_title`, `social_description`,
`social_image_url`).

<Aside type="tip">
Regenerá la miniatura del preview cuando quieras con
`POST /v1/artifacts/{id}/screenshot` — un screenshot headless usado como
`og:image` por defecto.
</Aside>

## Servido

| URL | Sirve |
| --- | --- |
| `/a/{slug}/` | Entrypoint (detección automática de mobile) |
| `/a/{slug}/{path}` | Un asset específico |
| `/a/{slug}/{path}?_raw` | Contenido raw para embeber en iframe |

## Auto-resumen y tags

Tras cada publish HTML exitoso, ShareOut corre un paso de IA en **background** sobre
el entrypoint de producción. Escribe una **descripción** de 1–2 oraciones (solo si
dejaste el campo vacío) y **3–6 tags** en la tabla `artifact_tags` existente. El
publish nunca espera este job — si la IA no está disponible, la página igual queda
en vivo.

Los auto-resúmenes alimentan subtítulos en tarjetas de Home, hits de búsqueda ⌘K,
el [digest semanal del workspace](/es/everyone/your-workspace/#digest-semanal-del-workspace)
y la entrada del learner de Knowledge. Las páginas viejas se rellenan con un drip
horario.

Podés setear tu propia descripción o tags con `PATCH /v1/artifacts/{id}` — tus valores
se conservan; el auto-resumen solo llena huecos.

## Eliminar y restaurar

Eliminar un artefacto es un **borrado suave** con una ventana de recuperación de 30
días — no un borrado inmediato:

```bash
curl -X DELETE https://shareout.site/v1/artifacts/art_abc123 \
  -H "Authorization: Bearer $TOKEN"
# → { "recoverable_until": "...", "retention_days": 30, "restore_url": "..." }
```

El artefacto deja de servirse y desaparece de tus listados, y su slug se libera para
poder volver a publicar el mismo slug — pero sus archivos, versiones y datos se
conservan intactos. Dentro de los 30 días podés recuperarlo:

```bash
curl https://shareout.site/v1/artifacts/deleted -H "Authorization: Bearer $TOKEN"   # papelera
curl -X POST https://shareout.site/v1/artifacts/art_abc123/restore \
  -H "Authorization: Bearer $TOKEN"                                                  # restaurar
```

En la UI del home está en el menú de la cuenta → **Eliminados recientemente**. Al
restaurar se asigna un slug nuevo si el original fue reclamado mientras tanto.

### Janitor de páginas sin uso

Una vez al mes (por workspace o cuenta personal), ShareOut marca **páginas publicadas
con cero vistas en 90+ días** cuando hay al menos tres. Las páginas con estrella
siempre se conservan. La campana muestra una tarjeta **Unused pages** con títulos de
muestra y **Archive all** — soft-delete de un clic a la misma papelera de 30 días
(lotes de 100 por clic). Admins de workspace usan `POST /v1/workspaces/{id}/unused/archive`;
cuentas personales usan `POST /v1/artifacts/unused/archive`.

<Aside type="caution">
Pasados 30 días, un barrido diario **elimina el artefacto de forma permanente** —
archivos, datos y todo. A partir de ahí no se puede restaurar.
</Aside>
