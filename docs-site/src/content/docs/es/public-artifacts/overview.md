---
title: Artifacts públicos — política y flujos
description: Quién puede publicar artifacts públicos, tus responsabilidades, cómo ShareOut los revisa y autoriza, consideraciones para Teams y Enterprise, monitoreo y manejo de abuso.
---

import { Aside } from '@astrojs/starlight/components';

Un **artifact público** es una página que cualquier persona en la web puede abrir —
sin iniciar sesión, sin invitación. Esta página es la política completa y cómo
funcionan los flujos: quién puede publicar públicamente, de qué sos responsable, qué
verifica ShareOut antes y después de que una página esté en vivo, en qué difiere para
Teams y Enterprise, y cómo funcionan el monitoreo y el manejo de abuso.

Para los detalles de la API (campo de visibilidad, `moderation_status`, opt-ins
anónimos, cuotas) mirá [Publicar artifacts](/es/guides/publishing/). Para lo básico
de compartir, mirá [Compartilo](/es/everyone/share-it/).

## Niveles de visibilidad

Cada artifact tiene una visibilidad. Vos la elegís; podés cambiarla después.

| Visibilidad | Quién puede abrirlo |
| --- | --- |
| `private` | Vos, y quienes compartas explícitamente (email/Google/contraseña). |
| `workspace` | Cualquier miembro del workspace del artifact. |
| `public` | Cualquiera en internet con el enlace; descubrible e indexable por buscadores. |

`public` es la única visibilidad **abierta**. Todo en esta página aplica a ella.
`private` y `workspace` son **cerradas** y nunca alcanzables por internet
de forma anónima.

<Aside type="caution">
Abierto significa abierto. La página de un artifact público **y sus datos
legibles** quedan disponibles para cualquiera. Nunca pongas secretos, credenciales ni
datos personales que no le darías a un desconocido en un artifact público.
</Aside>

## Quién puede publicar públicamente

Publicar un artifact abierto requiere más que uno cerrado, a propósito — es lo que
evita que el hosting gratuito y anónimo se convierta en un imán de abuso.

- **Un email verificado.** Las cuentas sin email verificado (anónimas, solo token)
  pueden publicar **en privado** pero no en público. Iniciá sesión con Google o con
  un código de un solo uso por email primero. (Las cuentas anónimas publicando en
  público serían la forma más barata de producir abuso en masa, así que está
  bloqueado.)
- **Un alta que pasó un control anti-bot.** Las cuentas nuevas pasan un desafío
  Cloudflare Turnstile, así que las altas no se pueden automatizar a escala.
- **Un plan pago (o workspace pago).** La visibilidad `public`
  es una función paga. Las cuentas personales free solo pueden publicar `private` y
  `workspace`. Tenés visibilidad abierta cuando **cualquiera** de esto es cierto: tu
  cuenta está en **Pro** o superior, el artifact vive en un workspace **Teams/Enterprise**
  con suscripción activa, o el workspace es un showcase público. Intentar ir abierto
  sin derecho mantiene el artifact en su visibilidad cerrada actual y muestra un aviso
  de upgrade — ShareOut ya no hace downgrade silencioso.

## De qué sos responsable (dueño)

Cuando hacés un artifact público, sos el publicador de ese contenido. Aceptás que:

- La página y sus datos legibles son visibles para todo el mundo. No ponés ahí nada
  que no puedas exponer públicamente.
- Tenés los derechos sobre lo que publicás, y no infringe la ley ni los términos de
  uso aceptable (nada de phishing, malware, fraude, contenido ilegal, ni contenido
  que apunte a dañar a otros).
- ShareOut puede revisar, retener, bloquear o dar de baja contenido público que
  viole estos términos, y puede suspender a quien reincida.

## Cómo ShareOut autoriza y verifica un artifact público

Los artifacts públicos pasan por controles en capas — antes de estar en vivo,
mientras se sirven, y de forma continua. Ningún control único es toda la defensa.

### 1. Al publicar — revisión de seguridad automática
La primera vez que publicás o cambiás un artifact a visibilidad abierta, ShareOut
corre una revisión de seguridad automática sobre la página:

- un **clasificador de contenido con IA** la evalúa por phishing, malware, estafas y
  contenido ilegal, y
- un **chequeo de reputación de URLs** (Cloudflare URL Scanner) mira los links
  salientes y los recursos embebidos.

El resultado define el estado de moderación del artifact:

| Estado | Qué pasa |
| --- | --- |
| **Aprobado** | Sale en vivo públicamente al instante. |
| **Pendiente** | Queda **privado** hasta liberarse (fail-safe). Se **revisa automáticamente** cada hora; vuelve a público solo cuando se aprueba. Los owners ven badges **Under review**; los visitantes ven una página de revisión dedicada. |
| **Bloqueado** | No se sirve; la página devuelve un aviso de "no disponible" y no se indexa. |

Re-publicar contenido sin cambios no se re-revisa; cambiar la página dispara una
revisión nueva.

### 2. Al servir — solo lectura por defecto
Una página pública la puede abrir cualquiera, pero **los visitantes anónimos son
solo lectura por defecto.** No pueden escribir datos, mandar email, usar el chat de
IA del artifact ni unirse a colaboración en tiempo real, salvo que vos lo habilites,
por capacidad:

| Opt-in | Permite a los visitantes anónimos… |
| --- | --- |
| `allow_anon_write` | Escribir en json / tables / blobs / datasets |
| `allow_anon_email` | Mandar email de formulario de contacto |
| `allow_anon_agent` | Usar el chat de IA del artifact |
| `allow_anon_collab` | Unirse a la colaboración en tiempo real |

Todos vienen apagados. Tus colaboradores con sesión conservan sus roles normales.
Mirá [Publicar artifacts](/es/guides/publishing/) para configurarlos.

### 3. Límites que contienen abuso y costo
- **Control anti-bot** en el alta (Turnstile).
- **Topes por cuenta** en cantidad de artifacts públicos, bytes guardados y ancho de
  banda diario (estimado). Las cuentas gratuitas tienen topes más bajos; pasarte de
  almacenamiento bloquea la publicación, y pasarte de ancho de banda puede pausar el
  servicio.
- **Límites de tasa** en publicación, escrituras anónimas, email de contacto y chat
  de IA — incluyendo un tope por visitante y uno por dueño, para que una página no
  pueda drenar el presupuesto de IA de una cuenta.

### 4. Continuo — después de estar en vivo
- Un **re-escaneo diario** vuelve a chequear las páginas públicas vivas contra
  reputación de URLs; una página cuyo host saliente se vuelve malicioso después se
  bloquea automáticamente.
- **Monitoreo del dominio de contenido** vigila la reputación del dominio
  compartido, así un problema se detecta antes de que afecte a otras páginas.

## Reportes y bajas

Cada página pública gratuita lleva un link de **Reportar** (en el badge "Made with
ShareOut"). Cualquiera puede marcar una página.

- Un reporte categorizado como material de abuso sexual infantil **pausa y bloquea de
  inmediato** la página y alerta a ShareOut — sin esperar revisión.
- Suficientes reportes independientes bloquean una página automáticamente, pendiente
  de revisión.
- ShareOut puede dar de baja una página (bloquear + pausar) y suspender una cuenta en
  cualquier momento.

Si tu página fue retenida o dada de baja y creés que es un error, podés pedir una
nueva revisión.

## Teams y Enterprise

La revisión de seguridad de arriba aplica a **todos** los artifacts públicos, en todo
plan — es una protección de plataforma, no una opción por workspace. Teams y
Enterprise suman:

- **Sin badge "Made with ShareOut"** en las páginas públicas (las gratuitas siempre lo muestran).
- **Topes más altos** de artifacts públicos, almacenamiento y ancho de banda.
- **Subdominio propio** (`tuequipo.shareout.site`) para tu workspace.
- **Roles de workspace.** Owners y admins gestionan schedules, automatizaciones,
  alertas de métricas, feature flags y tokens de miembros del equipo — mirá
  [Admin del workspace](/es/teams/admin/).
- **Gobernanza de publicación por workspace.** Los owners/admins pueden exigir
  aprobación interna antes de que un miembro lleve un artifact a visibilidad
  `public`.

### Política de publicación del workspace

Cada workspace tiene una `public_publish_policy` (por defecto `allow`):

| Política | Comportamiento |
| --- | --- |
| `allow` | Los miembros publican en abierto libremente (sujeto a la revisión de seguridad de la plataforma). |
| `prohibit` | Los miembros no pueden ir a abierto — el artifact queda en `workspace` con un aviso. |
| `require_approval` | Queda en `workspace` hasta que **N** miembros nominados aprueben; después pasa a la visibilidad pedida y corre la revisión de seguridad de la plataforma. |

Los owners/admins configuran la política en la app, en **Admin del workspace →
Publicación** (o vía API REST). Cuando un miembro intenta llevar un artifact a
abierto y el workspace exige aprobación, la app abre un selector de aprobadores:
el miembro nomina exactamente **N** compañeros y la página queda visible para el
workspace hasta que todos aprueben. Los aprobadores nominados (y el solicitante)
ven las solicitudes pendientes en **Aprobaciones** en la barra lateral del
workspace, donde aprueban o rechazan; la barra muestra un indicador cuando una
solicitud requiere al usuario actual. Mirá
[Publicar artifacts → Gobernanza de publicación](/es/guides/publishing/#gobernanza-de-publicacion-del-workspace).

La aprobación está atada al hash del contenido — volver a publicar el mismo
contenido sin cambios no requiere una nueva ronda. Las colas centrales de
seguridad y abuso de ShareOut siguen aplicando encima de cualquier política del
workspace.

## Monitoreo y estadísticas

- **Analytics de cuenta** — en Home, abrí **Analytics** desde la barra lateral para
  un resumen de todos tus artifacts: vistas, visitantes únicos, artifacts activos,
  tiempo de carga (p75 LCP con 20+ muestras), gráfico de tendencia, top artifacts
  (clic para el detalle por artifact), países y referrers. Filtrá por 7 / 30 / 90
  días con `GET /v1/home/analytics?range=`.
- **Viewers en vivo** — el detalle de analytics por artifact muestra **N viewers ahora**
  (solo owners/colaboradores; polling cada ~15s). Es distinto de la presencia "otros acá"
  del panel de comentarios.
- **Stats por artifact** — cada artifact público también tiene vistas, visitantes
  únicos y rendimiento real de usuarios cuando hay suficientes visitas. Owners y
  colaboradores ven un **desglose por viewer** — nombre, email y última vista de
  cada invitado o viewer autenticado (colaboradores, miembros del workspace,
  sharees externos). Las vistas públicas anónimas siguen siendo solo conteo. Se
  muestra en **Details** de Home Studio, el panel **Stats** del overlay de share
  y la página `/admin` por artifact.
- **Del lado de la plataforma**, ShareOut monitorea la cola de moderación, los
  reportes de abuso, la reputación del dominio de contenido y el uso por cuenta para
  mantener el hosting público seguro; estas vistas operativas las gestiona ShareOut,
  no se exponen por workspace.

## Disponibilidad y cómo se puede pausar

La publicación pública se habilita en olas en vez de todo de una, y ShareOut mantiene
un kill switch: si el abuso se dispara, la nueva publicación pública se puede pausar
al instante (los artifacts privados/cerrados existentes no se ven afectados). Esto es
normal en una plataforma de hosting y nos permite abrir el acceso de forma segura.

## Relacionado

- [Publicar artifacts](/es/guides/publishing/) — la API: visibilidad, `moderation_status`, opt-ins anónimos, cuotas.
- [Compartilo](/es/everyone/share-it/) — la versión simple de compartir y visibilidad.
- [Quién ve qué](/es/everyone/who-sees-what/) — visibilidad de datos por visitante (a nivel fila).
- [Admin del workspace](/es/teams/admin/) — controles de admin para Teams/Enterprise.
