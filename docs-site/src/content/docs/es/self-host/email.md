---
title: Correo
description: Enviá y recibí correo desde tu instancia, o corré sin eso.
---

ShareOut funciona sin correo a propósito — **el ingreso con contraseña es el camino por
defecto y no necesita ningún proveedor de correo**. El correo es lo que agregás cuando
querés que invitaciones, resúmenes y códigos de un solo uso lleguen a una bandeja en vez
de a un log.

## Qué queda apagado sin eso

| Función | Sin el binding `EMAIL` |
|---------|------------------------|
| Códigos de ingreso de un solo uso | Se escriben en el log del Worker. Sirve para quien opera solo, no para un equipo |
| Invitaciones al espacio de trabajo | No se mandan por correo — usá **Copiar enlace** y pasá vos la URL ([abajo](#invitar-gente-sin-correo)) |
| Resumen semanal, notificaciones | No se entregan |
| Correo de páginas, entregas de agentes | No se entregan |
| **Ingreso con contraseña** | **No se ve afectado.** Por eso una instancia es usable sin nada de correo |

## Enviar

El binding viene comentado en `wrangler.toml`. Descomentalo:

```toml
[[send_email]]
name = "EMAIL"
```

Configurá el remitente y redesplegá:

```toml
[vars]
EMAIL_DEFAULT_FROM = "shareout@tuempresa.com"
```

```bash
npm run deploy
```

Bindings y vars son de tiempo de despliegue — a diferencia de los secretos, no tienen
efecto hasta que el redespliegue termina.

:::caution
Cloudflare no deja que un Worker envíe a direcciones arbitrarias. El destinatario tiene
que ser una **dirección de destino verificada en tu cuenta de Cloudflare**, o estar dentro
de lo que el binding permite. Esta es la razón más común de que una instancia bien
configurada igual no mande nada — revisá la sección Email del panel de Cloudflare antes de
depurar ShareOut. Mirá la documentación de Email Routing de Cloudflare para las reglas
vigentes.
:::

Verificá leyendo la configuración de vuelta:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Authorization: Bearer $SHAREOUT_TOKEN" | jq '.email'
```

`binding: true` y un `default_from` significan que el envío está vivo. Después mandá uno
de verdad: invitate a un espacio y mirá si llega.

## Recibir

Las páginas y los espacios pueden aceptar correo entrante: una bandeja de archivos por
espacio, y direcciones por página.

1. Activá **Email Routing** en tu dominio, en Cloudflare.
2. Ruteá un catch-all a este Worker. El Worker exporta un handler `email()`; Cloudflare le
   entrega ahí.
3. Configurá el dominio donde viven esas direcciones:

   ```toml
   [vars]
   EMAIL_INBOX_DOMAIN = "inbox.tuempresa.com"
   ```

   Sin configurar, usa `inbox.<host de tu instancia>`.

El subdominio de bandeja está separado del apex a propósito, para que un catch-all nunca
se trague casillas reales como `hola@tuempresa.com`.

Cuando está vivo, **Admin → Configuración** muestra la dirección de la bandeja del
espacio. Si esa sección no aparece, la instancia no tiene binding de correo — la dirección
se oculta en vez de mostrarse como algo que no puede recibir.

## Entregabilidad

Mandes lo que mandes, la reputación del dominio remitente es tuya:

- SPF, DKIM y DMARC en el dominio remitente — el panel de Cloudflare te guía
- una dirección `From` real y monitoreada, no `noreply@`
- ShareOut mantiene una lista de supresión y respeta las bajas por categoría; un rebote o
  una queja corta los envíos futuros a esa dirección por su cuenta

## Invitar gente sin correo

Invitá como siempre — **Admin → Miembros**, poné la dirección. La invitación se crea salga
o no el correo. Después aparece en **Invitaciones pendientes** con dos botones:

- **Copiar enlace** — genera la URL de ingreso y la copia. Mandala por donde quieras:
  Slack, chat, a viva voz. No se manda ningún correo.
- **Reenviar** — vuelve a mandar el correo. Sin el binding `EMAIL` no hace nada útil.

El enlace es `{origen}/invite/{código}`. Es de un solo uso, vence a los 7 días y sirve solo
para la dirección a la que se emitió.

Copiar un enlace nunca invalida uno que mandaste antes — cada vez que apretás se genera un
reclamo más, y todos los no usados siguen sirviendo hasta que vencen. **Revocar** (×) los
mata a todos de una.

```bash
# Lo mismo por API — notify:false genera un enlace sin mandar correo
curl -sS -X POST "$ORIGIN/v1/workspaces/$WORKSPACE_ID/invites/$INVITE_ID/resend" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"notify":false}' | jq -r '.inviteUrl'
```

:::note
El código se guarda hasheado, así que solo se puede leer en el momento en que se genera. No
hay endpoint que devuelva el enlace de una invitación existente — apretar **Copiar enlace**
de nuevo genera uno fresco, que es justamente por qué funciona incluso con invitaciones
creadas antes de leer esta página.
:::

## Correr sin correo a propósito

Una instancia privada para un equipo chico es una configuración sin correo perfectamente
válida:

- la gente entra con **correo y contraseña** (`/setup` para el primer admin)
- las invitaciones funcionan con **Copiar enlace**, acá arriba — no hace falta proveedor
- los códigos de un solo uso siguen funcionando si podés leer el log del Worker
- `/v1/admin/instance` lista el hueco `EMAIL binding`, así queda como una decisión visible
  y no como algo que te olvidaste
