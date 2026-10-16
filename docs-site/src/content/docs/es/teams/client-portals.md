---
title: Portales de clientes
description: Convertí una carpeta compartida en un portal con la marca del cliente — acceso con vencimiento, un enlace al portal y un registro de quién abrió qué.
---

import { Aside } from '@astrojs/starlight/components';

Un **portal de cliente** es una carpeta del Team Space compartida con personas de afuera
del workspace. Reciben un solo enlace que muestra únicamente los artefactos y archivos de
esa carpeta, con su propia marca. Vos decidís cuánto dura el acceso y ves qué abrieron.

<Aside type="note">Los portales se apoyan en [Compartir con clientes](/es/teams/external-sharing/). Las personas externas son gratis y nunca cuentan como asientos.</Aside>

## Armá uno

1. Creá una carpeta en el Team Space (por ejemplo *Acme — revisión Q3*) y guardá ahí los
   artefactos y archivos que querés que vea el cliente. Las subcarpetas se incluyen.
2. Abrí la carpeta y hacé clic en su **etiqueta de acceso** para abrir **Quién tiene acceso**.
3. En **Personas fuera del espacio**, agregá un email (por ejemplo `alice@example.com`),
   elegí **View** o **Comment**, y cuándo **El acceso termina**.
4. Tocá **Copiar enlace del portal del cliente** y mandalo, o dejá que lo haga el email
   de invitación.

El email de invitación lleva directo al portal. Una persona nueva inicia sesión (o crea su
cuenta) y cae ahí; alguien que ya tenía acceso recibe un email de "te agregaron" con el
mismo enlace.

## La página del portal

El portal vive en `/shared?folder=<folderId>`. Lista solo el contenido de esa carpeta y
sus subcarpetas, con el nombre de la carpeta como título y la marca (logo y color) de la
[org de cliente](/es/teams/external-sharing/#cómo-funciona) a la que pertenece la persona
en tu workspace. **← Shared with you** vuelve a todo lo que se compartió con ella.

Si la carpeta no existe o no se compartió con esa persona, el enlace abre su página
completa de **Shared with you**, sin decir por qué.

## Acceso con vencimiento

Cuando compartís con una persona, **El acceso termina** puede ser:

| Opción | El acceso termina |
| --- | --- |
| **Nunca** | Cuando lo quitás |
| **En 7 días** / **En 30 días** / **En 90 días** | Esa cantidad de días desde hoy |
| **En una fecha…** | Al final del día que elegís (UTC) |

El panel muestra "vence en N días" (o "vence hoy") junto a cada persona. El acceso se corta
apenas vence. Si volvés a compartir con la misma persona, la fecha nueva reemplaza a la
anterior: así extendés, acortás o revivís el acceso.

## Quién abrió qué

Quienes gestionan la carpeta ven **Quién abrió qué** en el mismo panel: cada vez que
alguien de afuera del workspace **abrió**, **comentó en** o **descargó** algo dentro de la
carpeta, con el artefacto y cuándo. Las aperturas repetidas de lo mismo por la misma
persona dentro de una hora cuentan una vez. Las visitas de tus propios miembros no
aparecen.

## Quién puede gestionar un portal

Los owners y admins del workspace gestionan cualquier carpeta. Quien **creó** la carpeta
también puede, mientras **Los miembros pueden crear carpetas** esté activado
(Admin → Settings). El resto ve **Quién tiene acceso** en modo solo lectura. Mirá
[Carpetas del Team Space](/es/teams/folders/#enlaces-y-acceso).

## API

Compartir con una persona (con vencimiento opcional) y el registro de actividad de la
carpeta están disponibles en la API REST. Mirá la [referencia de la API](/api/) para
los endpoints de compartir y de carpetas.
