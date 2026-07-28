---
title: Recibí emails
description: Dale a tu página su propia dirección de email — reenviá correos ahí y tu página reacciona. Guardá el mensaje, recibí un aviso o dispará una automatización.
---

Tu página puede tener su **propia dirección de email**. Todo lo que mandes ahí aparece en tu página — y puede disparar una automatización. No hay casilla que conectar ni cuenta que vincular: la dirección es tuya, y funciona sin importar desde dónde te escriban.

> *Reenviá las expensas del edificio a tu página → anota el monto y te recuerda 3 días antes del vencimiento.*

## Activala

Abrí tu página en el **editor** y tocá el botón **Inbox** (el sobre en la barra). Apretá **Activar inbox** y vas a tener una dirección como:

```
tu-pagina@inbox.YOUR_DOMAIN
```

La copiás con un clic. También podés activarla desde el panel de **Inicio** — abrí los detalles de una página y buscá la sección **Inbox**.

## Hacé que lleguen mails

Dos formas fáciles:

- **Repartí la dirección.** Ponela en un formulario, dásela a un proveedor, usala como tu dirección de "mandá los comprobantes acá".
- **Reenviá desde tu casilla actual.** En Gmail (o Outlook) creá un filtro — *"de facturacion@… → reenviar a tu-pagina@inbox.YOUR_DOMAIN"* — y no pensás más en eso.

:::tip[Agregá una etiqueta con “+”]
`tu-pagina+comprobantes@inbox.YOUR_DOMAIN` llega al **mismo** inbox, etiquetado como `comprobantes`. Usá etiquetas para distinguir tipos de mail y que una automatización los trate distinto.
:::

## Mirá qué llega

Cada mensaje aparece en tu página — en el panel **Inbox** del editor y en el cajón de detalles de Inicio. Tocá uno para leer el texto completo y **descargar los adjuntos** (la factura en PDF, la foto, lo que haya llegado).

## Que *haga* algo

Sola, la casilla solo junta correos. Combinala con una [**automatización**](/es/everyone/automations/) y cada mail nuevo puede:

| Cuando llega un mail… | …tu página puede |
| --- | --- |
| Entra un comprobante | Guardar el monto en una lista |
| Te escribe un proveedor | Avisarte por Telegram o Slack |
| Llega una respuesta de un formulario | Avisarle a tu equipo |
| Llega cualquier cosa | Mandar una señal a otra app |

Configurás una vez la automatización "cuando llega un email" y corre siempre — convirtiendo tu casilla en acción.

## Un ejemplo real

1. Hacé una página **"Gastos"** y activá su inbox → `gastos@inbox.YOUR_DOMAIN`.
2. En Gmail, reenviá las facturas del edificio a esa dirección (un filtro).
3. Agregá una automatización: *cuando llega un email, guardá el monto y recordame por Telegram 3 días antes del vencimiento.*

Ahora cada factura entra y se resuelve sola — vos no hacés nada.

## Vos tenés el control

- **Remitentes permitidos** — dejala abierta a cualquiera, o limitala a ciertas personas o dominios (por ejemplo, solo `@tuempresa.com`). Los remitentes falsificados se rechazan automáticamente.
- **Apagala** cuando quieras. Los mails nuevos se rechazan; todo lo que ya recibiste queda.
- Es **por página y opcional** — nada recibe correo hasta que lo activás.

## Qué sigue

- [**Ponelo en piloto automático**](/es/everyone/automations/) — que el correo entrante dispare una acción.
- [**Listas y datos**](/es/everyone/your-data/) — guardá lo que llega como filas que podés ordenar y filtrar.
