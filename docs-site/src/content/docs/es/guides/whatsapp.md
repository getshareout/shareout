---
title: Asistente en WhatsApp
description: Hablá con los artefactos de tu workspace por WhatsApp — el mismo asistente y los mismos comandos que en Telegram, activado por workspace y cobrado por respuesta.
---

import { Steps, Aside } from '@astrojs/starlight/components';

El asistente de ShareOut también responde por **WhatsApp**: el mismo asistente, los mismos
comandos y las mismas confirmaciones que el [bot de Telegram](/es/guides/telegram-bot/).
Trabaja dentro de un workspace a la vez y solo ve lo que tu cuenta de ShareOut ve ahí.

Solo responde. La persona escribe primero; ShareOut nunca empieza una conversación por
WhatsApp.

## Activarlo en un workspace

WhatsApp está **apagado** hasta que un dueño o admin del workspace lo activa: **Admin →
Configuración → WhatsApp → Permitir que los miembros usen el asistente por WhatsApp**. El
switch aparece solo cuando la instancia tiene un número de WhatsApp configurado.

Cada respuesta del asistente es un mensaje de WhatsApp que se cobra al workspace. Cuenta
para el presupuesto mensual de IA del workspace y aparece en el reporte de IA, en **Por
canal → WhatsApp** y **Mensajes de WhatsApp**, junto al uso de IA del propio asistente.

## Conectar tu WhatsApp

<Steps>

1. En ShareOut, abrí el menú de tu cuenta → **Conectar WhatsApp**.
2. WhatsApp se abre con un mensaje listo, que incluye un código de un solo uso válido por
   **15 minutos**. Tocá **Enviar**.
3. El asistente confirma quién sos y en qué workspace trabaja. Si estás en varios workspaces
   con WhatsApp activado, te pregunta cuál.

</Steps>

Mandá `/unlink` para desconectarte. Para pasar a otro workspace, mandá `/workspace`.

## Qué cambia respecto de Telegram

Cada mensaje de WhatsApp cuesta plata, así que el asistente escribe **un mensaje por
respuesta**:

- no escribe la respuesta en vivo ni manda líneas de "estoy en eso" — ves *escribiendo…*
  hasta que está lista;
- `/artifacts` y `/search` mandan una sola lista con el link de cada artefacto, en vez de una
  tarjeta por artefacto;
- una nota de voz se contesta directo, sin repetir primero la transcripción;
- las respuestas de soporte llegan por mail y en ShareOut (WhatsApp solo deja que ShareOut
  responda dentro de las 24 horas de tu último mensaje).

No lee fotos ni archivos; mandá texto o una nota de voz.

## Para quien opera la instancia

El asistente usa directamente la WhatsApp Cloud API de Meta. Necesitás un negocio verificado
en Meta, un número de WhatsApp Business, una app con el producto WhatsApp y un medio de pago
en el Billing Hub de Meta (los mensajes de servicio se cobran desde el 1 de octubre de 2026,
después de 1.000 gratis por mes por número).

| Variable | Tipo | Qué es |
| --- | --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | var | El id del número de negocio (app de Meta → WhatsApp → API setup). |
| `WHATSAPP_ACCESS_TOKEN` | secret | Un token de usuario del sistema con `whatsapp_business_messaging`. |
| `WHATSAPP_APP_SECRET` | secret | El secreto de la app de Meta; cada llamada al webhook se valida con su firma. |
| `WHATSAPP_VERIFY_TOKEN` | secret | Cualquier texto; escribí el mismo en la configuración del webhook. |
| `WHATSAPP_BUSINESS_NUMBER` | var | El número en dígitos internacionales (`5491112345678`), para el link de Conectar. |

Apuntá el webhook de la app a `https://<tu instancia>/whatsapp/webhook` y suscribite al campo
**messages**.

<Aside type="caution">
Los términos de Meta prohíben ofrecer un asistente de IA de propósito general en su
plataforma de negocios. El asistente se queda en ShareOut — artefactos, datos, conocimiento,
compartir, envíos programados y alertas del workspace — y rechaza todo lo demás en una frase.
</Aside>

Cada respuesta se mide al precio de lista de Meta para el país de quien la recibe (la tarifa
en USD vigente desde el 1 de octubre de 2026) y se revende con el markup de IA del workspace,
como el resto de su uso de IA. El tramo gratuito mensual no se traslada.
