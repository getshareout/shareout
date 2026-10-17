---
title: Dominio propio
description: Usá un workspace en un dominio tuyo, como portal.acme.example.
---

Un workspace puede funcionar en un dominio tuyo — `portal.acme.example` — en lugar de (o
además de) `{workspace}.{instancia}`. Todo lo que sirve el subdominio del workspace
funciona ahí también: el inicio del workspace, los artefactos, el inicio de sesión y la
API. Cuando un dominio propio es el **principal** del workspace, los links para
compartir, los resultados de publicación y los emails de invitación lo usan.

Los `owner` y `admin` del workspace manejan los dominios en **Admin → Dominio propio**.

## Cómo configurarlo

1. En **Admin → Dominio propio**, escribí el dominio (por ejemplo `portal.acme.example`) y
   elegí **Agregar dominio**. Empieza como *Esperando el DNS*.
2. En tu proveedor de DNS, agregá los registros que muestra la página:

   | Tipo | Nombre | Valor |
   | --- | --- | --- |
   | `CNAME` | `portal.acme.example` | el destino que muestra la página (por ejemplo `customers.{instancia}`) |
   | `TXT` | el nombre de verificación que se muestra (`_cf-custom-hostname.portal.acme.example`, o `_shareout-verify.portal.acme.example` en instancias en modo manual) | el valor de verificación que se muestra |

   Usá un subdominio (`portal.`, `docs.`, …). La mayoría de los proveedores de DNS no
   permiten un `CNAME` en el dominio pelado (`acme.example`).
3. Elegí **Volver a revisar**. Los cambios de DNS suelen verse en minutos; el certificado
   HTTPS se emite solo. Cuando el estado dice **Activo**, el dominio funciona.
4. Elegí **Hacer principal** si querés que los links y emails lo usen.

Mientras un dominio no esté **Activo** no sirve nada — ni tu workspace ni el de nadie.

## Iniciar sesión en un dominio propio

El dominio propio tiene su propia sesión. Cuando alguien inicia sesión ahí, ShareOut lo
lleva a la página de inicio de sesión de la instancia y lo trae de vuelta con un código
de un solo uso que sólo sirve en ese dominio, durante un minuto. Se inicia sesión una vez
por dominio.

## Reglas

- Un dominio pertenece a un solo workspace. Otro workspace no puede agregar un dominio
  **Activo** hasta que el workspace actual lo elimine.
- Un reclamo sin verificar que nunca se activó vence a los 7 días, así nadie puede
  bloquear un dominio que no controla.
- **Eliminar** saca el dominio al instante; los links en ese dominio dejan de funcionar.
- Hasta 10 dominios propios por workspace.

## API

```http
GET    /v1/workspaces/{workspaceId}/domains            # ?refresh=1 vuelve a revisar los pendientes
POST   /v1/workspaces/{workspaceId}/domains            { "hostname": "portal.acme.example" }
POST   /v1/workspaces/{workspaceId}/domains/{id}/refresh
PATCH  /v1/workspaces/{workspaceId}/domains/{id}       { "primary": true }
DELETE /v1/workspaces/{workspaceId}/domains/{id}
```

Cada dominio trae `status` (`pending`, `active`, `failed`), `is_primary`, los registros
`dns` a agregar e `instructions` en lenguaje simple.

## Para quien opera la instancia

Los dominios propios están apagados hasta que los activás:

- **Cloudflare for SaaS** (Cloudflare maneja certificados y verificación): configurá el
  secreto `CF_CUSTOM_HOSTNAMES_TOKEN` (Zone → SSL and Certificates: Edit), la variable
  `CF_CUSTOM_HOSTNAMES_ZONE_ID` y `CUSTOM_DOMAINS_CNAME_TARGET` (el dominio al que los
  clientes apuntan su CNAME). Activá Cloudflare for SaaS en la zona, creá el fallback
  origin y dirigí `*/*` al Worker — ver
  [getting started](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/)
  y [Workers as your fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/).
- **Modo manual** (sin credenciales de Cloudflare): configurá sólo
  `CUSTOM_DOMAINS_CNAME_TARGET`. ShareOut verifica la propiedad con el registro TXT
  `_shareout-verify`; vos dirigís cada dominio verificado al Worker (un custom domain o
  una route de Workers).
