---
title: Recibí emails
description: Dale a tu artefacto su propia dirección de email — reenviá correos ahí y tu artefacto reacciona. Guardá el mensaje, recibí un aviso o dispará una automatización.
---

Tu artefacto puede tener su **propia dirección de email**. Todo lo que mandes ahí aparece en tu artefacto — y puede disparar una automatización. No hay casilla que conectar ni cuenta que vincular: la dirección es tuya, y funciona sin importar desde dónde te escriban.

> *Reenviá las expensas del edificio a tu artefacto → anota el monto y te recuerda 3 días antes del vencimiento.*

## Activala

Abrí tu artefacto en el **editor** y tocá el botón **Inbox** (el sobre en la barra). Apretá **Activar inbox** y vas a tener una dirección como:

```
gastos.k7m4p2@inbox.YOUR_DOMAIN
```

Es corta a propósito, para que sea fácil de escribir o de dictar por teléfono: la primera palabra
del nombre del artefacto, un punto y seis letras y números. La copiás con un clic. (Una dirección
que el artefacto ya tenía sigue funcionando.) También podés activarla desde el panel de **Inicio** — abrí los detalles de un artefacto y buscá la sección **Inbox**.

## Hacé que lleguen mails

Dos formas fáciles:

- **Repartí la dirección.** Ponela en un formulario, dásela a un proveedor, usala como tu dirección de "mandá los comprobantes acá".
- **Reenviá desde tu casilla actual.** En Gmail (o Outlook) creá un filtro — *"de facturacion@… → reenviar a gastos.k7m4p2@inbox.YOUR_DOMAIN"* — y no pensás más en eso.

:::tip[Agregá una etiqueta con “+”]
`gastos.k7m4p2+comprobantes@inbox.YOUR_DOMAIN` llega al **mismo** inbox, etiquetado como `comprobantes`. Usá etiquetas para distinguir tipos de mail y que una automatización los trate distinto.
:::

## Mirá qué llega

Cada mensaje aparece en tu artefacto — en el panel **Inbox** del editor y en el cajón de detalles de Inicio. Tocá uno para leer el texto completo y **descargar los adjuntos** (la factura en PDF, la foto, lo que haya llegado).

## Que *haga* algo

Sola, la casilla solo junta correos. Combinala con una [**automatización**](/es/everyone/automations/) y cada mail nuevo puede:

| Cuando llega un mail… | …tu artefacto puede |
| --- | --- |
| Entra un comprobante | Guardar el monto en una lista |
| Te escribe un proveedor | Avisarte por Telegram o Slack |
| Llega una respuesta de un formulario | Avisarle a tu equipo |
| Llega cualquier cosa | Mandar una señal a otra app |

Configurás una vez la automatización "cuando llega un email" y corre siempre — convirtiendo tu casilla en acción.

## Empezá desde un Excel

¿Todavía no tenés el artefacto? En **Nuevo → Tabla desde un Excel**, elegí un Excel (.xlsx) o un
CSV de tu computadora. ShareOut arma un artefacto con una tabla prolija — la primera fila son los
títulos de las columnas — que se lee bien en el celular y dice cuándo se actualizó. Después te
pregunta cómo mantenerla al día: **mandando el Excel por email** está a un toque (solo decís quién
lo manda), o desde Google Drive, o desde un enlace. Si el archivo no sirve (muy grande, vacío, no es
una planilla) te dice en una frase qué hacer.

## Actualizá los números de tu artefacto mandando el Excel por email

¿Alguien te manda la misma planilla todas las semanas? Tu artefacto puede actualizarse solo con
ella. Abrí el artefacto desde Inicio, andá a **Automatizar → Actualizar los datos** (en el celular:
**Opciones → Automatizar**) y elegí **Mandando el Excel por email**. Decí quién manda el archivo (solo su email), tocá **Activar** y
vas a tener la dirección del artefacto. Después, cada vez:

1. Abrí tu correo.
2. Escribí un email nuevo a la dirección del artefacto.
3. Adjuntá el Excel y mandalo. El asunto y el texto no importan.

Unos segundos después el artefacto muestra los números nuevos. Bueno saber:

- La **primera fila** de la primera hoja son los títulos de las columnas.
- Cada archivo **reemplaza** los datos que muestra el artefacto.
- Solo las personas que pusiste pueden actualizarlo; el correo de cualquier otra persona se
  devuelve. Usá la dirección completa (por ejemplo `ana@gmail.com`), no todo `@gmail.com`.
- Si un archivo no se puede usar, el artefacto mantiene los números anteriores y te llega un email
  diciendo por qué.
- Límites: 8 MB y 100.000 filas por archivo, 25 MB por email, 200 emails por día.

### Que tu reporte llegue solo

¿El reporte ya te llega por email? Tu correo lo puede reenviar solo al artefacto. Los pasos también
están en la ventana **Actualizar por email** del artefacto, en **Que tu reporte llegue solo**.

**Gmail**

1. En Gmail: **Configuración → Ver todos los ajustes → Reenvío y correo POP/IMAP → Agregar una
   dirección de reenvío**. Pegá la dirección del artefacto.
2. Gmail le manda una confirmación al artefacto. En unos segundos aparece arriba de la ventana
   **Actualizar por email**: *"Gmail quiere confirmar el reenvío desde ana@…"*. Tocá **Confirmar**:
   se abre Google en otra pestaña, y ahí tocá **Confirmar** otra vez. Después decí de quién es el
   reporte (la dirección de la que te llega) y tocá **Permitir**.
3. Abrí uno de los reportes en Gmail → **⋮ → Filtrar mensajes similares → Crear filtro** → marcá
   **Reenviarlo a** y elegí la dirección del artefacto.

Solo se reenvía el reporte: no actives "Reenviar una copia del correo entrante", con el filtro
alcanza. ¿No reconocés la dirección de la confirmación? Tocá **No es mío** y no se confirma nada.

**Outlook o Microsoft 365**

1. En Outlook: **Configuración → Correo → Reglas → Agregar nueva regla**.
2. Condición: **De** → quien te manda el reporte. Acción: **Reenviar a** → la dirección del
   artefacto. Guardar.
3. El reenvío sale de tu propia dirección, así que tiene que estar en **Quién puede mandarlo** (ya
   está si lo configuraste con ella).

Outlook no pide confirmación. Si no llega nada, puede que tu empresa no permita reenviar correos
afuera, y Outlook no te avisa. Pedile a la persona de sistemas que habilite el reenvío automático
para tu correo.

**¿Se rebotó un reporte reenviado?** Un filtro de Gmail mantiene al remitente original del reporte,
y solo las personas que pusiste pueden actualizar el artefacto. La ventana dice entonces *"Llegó un
archivo de reportes@… reenviado desde tu correo, pero se rebotó"* con un botón, **Permitir a
reportes@…**. Tocalo y el próximo reporte actualiza el artefacto (reenviá el último para no
esperar). El artefacto además guarda los últimos emails que rebotó, así un email suelto no tapa el
que estás buscando.

## Un ejemplo real

1. Hacé un artefacto **"Gastos"** y activá su inbox → `gastos.k7m4p2@inbox.YOUR_DOMAIN`.
2. En Gmail, reenviá las facturas del edificio a esa dirección (un filtro).
3. Agregá una automatización: *cuando llega un email, guardá el monto y recordame por Telegram 3 días antes del vencimiento.*

Ahora cada factura entra y se resuelve sola — vos no hacés nada.

## Vos tenés el control

- **Remitentes permitidos** — dejala abierta a cualquiera, o limitala a ciertas personas o dominios (por ejemplo, solo `@tuempresa.com`). Los remitentes falsificados se rechazan automáticamente.
- **Apagala** cuando quieras. Los mails nuevos se rechazan; todo lo que ya recibiste queda. (Un artefacto que se actualiza por email apaga su dirección cuando dejás de **Actualizar por email**.)
- Es **por artefacto y opcional** — nada recibe correo hasta que lo activás.

## Qué sigue

- [**Ponelo en piloto automático**](/es/everyone/automations/) — que el correo entrante dispare una acción.
- [**Listas y datos**](/es/everyone/your-data/) — guardá lo que llega como filas que podés ordenar y filtrar.
