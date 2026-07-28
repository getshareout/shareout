---
title: Archivos y entregas
description: Guardá imágenes, video y cualquier archivo en un solo lugar, reutilizalos en tus páginas y enviá al cliente un link de descarga limpio.
---

La pestaña **Assets** en tu Home es un lugar para guardar archivos — imágenes, video, PDFs, hojas de cálculo, decks, zips, lo que sea — guardalos una vez, reutilizalos en tus páginas y entregale al cliente un link de descarga limpio.

Abrilo desde el rail izquierdo de Home: **Assets**.

## Agregar archivos

Hacé clic en **Upload files** y elegí uno o varios. No hay "¿qué tipo?" — podés subir un video de 2&nbsp;GB, un `.xlsx`, un `.pptx`, un `.zip`. Cada archivo se convierte en un **deliverable** que podés reutilizar y compartir.

### Sin abrir Assets

Los archivos también pueden entrar a tu biblioteca desde tres lugares más — cada uno guarda **de dónde vino** para que el asistente del workspace lo encuentre después:

| Canal | Cómo | Quién |
| --- | --- | --- |
| **Inbox de archivos del workspace** | Adjuntos por email a `{slug-del-workspace}@inbox.YOUR_DOMAIN` | Solo miembros del workspace — el remitente debe estar registrado con ese email |
| **Adjunto en el chat** | Clip en el compositor **Ask your workspace…** de Home | Vos (sube al bucket de assets de tu scope) |
| **Compartir desde el teléfono** | Instalá ShareOut como PWA y **Compartir → ShareOut** desde cualquier app | Vos — abre Home con el archivo listo para adjuntar en el chat |

La dirección del inbox del workspace está en **Admin → Settings → File inbox** (copiá con un clic). Los admins reciben notificación en la campana y opcionalmente por Telegram cuando un miembro manda archivos por email. Hojas de cálculo (`.xlsx`, `.csv`), decks (`.pptx`), PDFs e imágenes son los casos típicos.

:::note[No es lo mismo que el inbox de una página]
El **inbox de una página** (`tu-pagina@inbox.YOUR_DOMAIN`) captura mail *dentro de un artifact* para automatizaciones — ver [Recibí emails](/es/everyone/inbox/). El **inbox de archivos del workspace** alimenta la biblioteca **Assets** compartida y al asistente con IA.
:::

## Organizar en carpetas

Usá la **barra de carpetas** arriba en Assets para agrupar archivos — entregables de clientes, assets de marca, material en bruto, lo que te sirva. **New folder** crea una carpeta en el mismo árbol compartido que usan tus páginas; **Move** en una tarjeta mete el archivo adentro.

Compartir una **carpeta** con un cliente (Admin → Compartir) también comparte los **archivos** que hay dentro — carpetas y páginas comparten un solo árbol.

## Visibilidad

Cada archivo es **visible para el workspace** (por defecto — cualquier miembro puede verlo e incrustarlo) o **privado** (solo vos, hasta que lo compartas). Cambiá la visibilidad en la tarjeta del archivo. Los privados llevan un badge.

- Los archivos **visibles para el workspace** se pueden incrustar en cualquier página del workspace con una URL estable (`/v1/files/dlv_…/content`).
- Los archivos **privados** quedan ocultos para otros miembros y para links de entrega anónimos — compartilos a propósito con [compartir externo](/es/teams/external-sharing/) o **Compartir con una persona** (abajo).

## Versiones

¿Reenviás el tercer corte de un video? Abrí el **＋** de un deliverable y subí el archivo nuevo — pasa a ser **v2**, **v3**, y así. La tarjeta siempre muestra la última versión con un badge `v3`; el ícono del reloj muestra todo el historial para recuperar una versión anterior.

## Comentar un archivo

Abrí el control de **comentarios** (ícono de chat) en una tarjeta para dejar un hilo en ese archivo.

- Mismo almacenamiento y notificaciones que los comentarios de páginas, pero **acotado solo a ese archivo**.
- Los miembros pueden comentar archivos **visibles para el workspace** (y siempre los que son de su autoría).
- Archivos **privados**: solo el dueño (y a quienes se los compartió) ven el hilo.
- Sharees externos necesitan grant **comment** para publicar; **view** alcanza para leer.
- Los hilos también aparecen en el portal **`/shared`** del destinatario.

API (`contextId: "file:…"`): [SDK: Comments](/es/sdk/comments/).

## Compartir con una persona (Teams)

En una tarjeta, **Share with a person** manda un solo archivo a un email externo — sin crear una org de cliente. Elegí **View** o **Comment**; reciben invitación (si son nuevos) y el archivo aparece en su portal **`/shared`**. Devuelve `409` si ese email ya es miembro interno del workspace — usá una invitación de colaborador normal.

En una **carpeta**, usá **Share folder** en la barra de carpetas — mismo flujo, otorga view o comment sobre toda la carpeta (páginas y archivos adentro). El modal lista **People you've shared with** para ese archivo o carpeta; revocá cualquier grant desde ahí.

Los sharees externos con acceso **comment** pueden dejar hilos en archivos compartidos directamente en el portal **`/shared`** — ver [Compartir externo](/es/teams/external-sharing/).

## Reutilizar un archivo en varias páginas

Cada asset tiene un link permanente. Hacé clic en **Copy link** en cualquier tarjeta y pegalo en una página (`<img>`, un botón, un link de descarga) — una sola fuente, usada en todos los artifacts que quieras. No tenés que tocar las páginas cuando cambiás el archivo; apuntan al mismo asset.

En HTML de artifact, preferí **`sdk.files.getUrl('dlv_…')`** para archivos del workspace — resuelve a la última versión y aplica visibilidad (los privados devuelven 403 a quien no esté autorizado). Ver [SDK: Archivos](/es/sdk/files/).

¿Editás una página? La barra del editor visual tiene un botón **Insert asset** — abrilo, elegí un archivo de tu biblioteca y se inserta directo en la página. Sin copiar links a mano.

## Enviar una entrega a un cliente

Es el flujo estilo WeTransfer:

1. Hacé clic en **Bundle files to send →**.
2. Marcá los archivos de esta entrega.
3. **Create delivery** → poné un nombre (ej. *"Archivos finales para Acme"*). Opcionalmente definí una **fecha de vencimiento** y **protegé el link** — con contraseña, o limitando a ciertos dominios de email (ej. solo `@acme.com`).
4. Obtenés un **link** a una página de descarga limpia y con marca que lista cada archivo con un botón Download.
5. **Copiá** el link para pegarlo donde quieras, o escribí el email del cliente y **Send** — recibe un mail ordenado con el link de descarga.

Los links protegidos bloquean la **página de descarga y los bytes del archivo** — el destinatario tiene que pasar la contraseña o el chequeo de dominio antes de que se sirva cualquier archivo. Para una entrega protegida, compartí el link `/d/<token>`, no el **Copy link** por archivo de la biblioteca (esa URL estable es para incrustar un asset en tus páginas).

Como es un link (no un adjunto), el tamaño no importa — podés enviar una carpeta de renders 4K igual que un logo.

## Gestionar entregas enviadas

Hacé clic en **Sent deliveries** arriba en Assets para ver cada link que creaste — nombre de la colección, cantidad de archivos, tipo de gate, vencimiento, conteo de aperturas y estado en vivo (activo, vencido o revocado). Desde ahí podés **copiar** un link de nuevo o **revocarlo**; un link revocado devuelve 404 tanto en la página como en las descargas.

## Notificaciones de apertura

La primera vez que alguien abre una entrega (pasado cualquier gate y con los archivos visibles), recibís un email — por ejemplo *"Acme abrió tu entrega."* Las reaperturas del mismo link no vuelven a notificar, así un refresh no te spamea. En un link con gate por dominio, el email del viewer se incluye en la notificación.

:::tip[Equipo vs. personal]
En un Team Space, la biblioteca Assets es compartida — cualquier miembro puede subir y enviar. En tu Home personal es solo tuyo.
:::
