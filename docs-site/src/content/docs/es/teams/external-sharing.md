---
title: Compartir con clientes (Clientes y socios)
description: Compartí carpetas y artefactos con clientes, proveedores y socios fuera de tu equipo — con marca, alcance acotado y seguimiento.
---

import { Aside } from '@astrojs/starlight/components';

Compartí trabajo **fuera de tu equipo** — con un cliente, proveedor, socio o inversor — sin sumarlos como miembros del workspace. Ven solo lo que compartís, en una página con tu marca, y vos podés ver cuándo lo abren.

<Aside type="note">Compartir con externos es una función de **Teams o Enterprise**. Las personas externas son **gratis e ilimitadas** — nunca cuentan para tus asientos.</Aside>

## Cómo funciona

1. **Creá un cliente.** Home → **Admin** → **Compartir** → **Agregar cliente o socio** — un formulario inline en la página (nombre de empresa + relación). Sin modal; el estado vacío guía los pasos y el mismo formulario aparece bajo el encabezado cuando ya hay clientes.
2. **Invitá a su gente.** Agregá emails — reciben una invitación e inician sesión como cualquier usuario de ShareOut. Siguen siendo externos (nunca en tu lista de miembros, nunca facturados).
3. **Compartí una carpeta o archivo.** Elegí una carpeta y un nivel — **Ver**, **Comentar**, **Puede crear** o **Puede editar**. Una carpeta comparte todo lo que hay adentro — **artefactos y archivos**. Desde Assets también podés **Share with a person** en un solo archivo (email + view/comment, sin org de cliente).
4. **Abren `/shared`.** Cada persona externa tiene una página "compartido con vos" con solo lo que les diste — artefactos y archivos descargables — con la marca de su org de cliente cuando están agrupados. Los visitantes nuevos ven una tarjeta de orientación breve. Los **archivos** compartidos con acceso **comment** incluyen un hilo de comentarios inline en la tarjeta del portal; los artefactos abren en el visor normal.

## Niveles de acceso

| Nivel | Pueden… |
| --- | --- |
| Ver | Abrir y leer los artefactos compartidos. |
| Comentar | Ver + dejar comentarios. |
| Puede crear | Crear artefactos nuevos **dentro** de la carpeta compartida (quedan privados a esa carpeta). |
| Puede editar | Editar los artefactos compartidos. |

Un nivel más alto incluye los de abajo. Podés compartir una carpeta entera con un cliente, un solo artefacto o un solo **archivo** desde Assets.

### Compartir con una persona (sin org de cliente)

`POST /v1/workspaces/{id}/share-person` invita un email externo y otorga **view** o **comment** sobre un **archivo** o **carpeta**. Requiere Teams/Enterprise (la función **External sharing** en self-host) + admin. La persona aparece en `/shared` sin crear una org de cliente. Devuelve `409 ALREADY_MEMBER` si el email ya es miembro interno.

Quienes gestionan una carpeta (no solo los admins) también pueden hacerlo desde el panel **Quién tiene acceso** de la carpeta. Solo se relaja el rol de admin: el workspace igual necesita compartir con externos activado, y el email tiene que pasar los dominios permitidos del workspace. Quitar a alguien nunca necesita el entitlement. Pueden elegir cuándo termina el acceso: **En 7 días**, **En 30 días**, **En 90 días**, **En una fecha…** o **Nunca**. El acceso se corta apenas vence; si volvés a compartir, la fecha nueva reemplaza a la anterior. El email de invitación lleva directo al portal de la carpeta. Mirá [Portales de clientes](/es/teams/client-portals/).

### Acceso de invitado (sin cuenta)

Para una carpeta, marcá **Acceso de invitado: sin cuenta** al compartir. La persona recibe un mail con un enlace que abre la carpeta; nada le pide crear una cuenta, recordar una contraseña ni elegir un workspace. En otro dispositivo abre el enlace del portal, escribe su mail e ingresa el código de 6 dígitos que le mandamos.

Un invitado ve solo esa carpeta y lo que tiene adentro, hasta el acceso que elegiste (**Puede ver** o **Puede comentar**). No tiene página de inicio, búsqueda, lista de miembros ni asistente. Si lo quitás, si pasa la fecha de fin o si borrás la carpeta, pierde el acceso en su próximo clic. API: `share-person` con `"guest": true`. Mirá [Portales de clientes](/es/teams/client-portals/#invitados-sin-cuenta).

## Recibos de lectura

Cada vez que un cliente abre algo que compartiste, queda registrado. En la vista del cliente vas a ver actividad reciente — *"alguien en Acme abrió el deck del Q3."* Una señal clara para renovaciones y seguimiento.

Para una carpeta puntual, **Quién abrió qué** en el panel de acceso de la carpeta lista qué abrieron, comentaron o descargaron ahí las personas de afuera.

## Acceso API para clientes

Si un cliente necesita traer sus datos por programación, generale un **token API** desde la fila de su miembro. El token solo alcanza lo que les diste — nunca el resto de tu workspace — y está orientado a lectura (no puede publicar). Copialo una vez; no se vuelve a mostrar.

## Notas sobre un cliente (tu asistente recuerda)

Cada cliente tiene una sección de **Notas** — privada para tu equipo, nunca compartida con el cliente. Anotá lo que sabés: cómo les gusta trabajar, qué pidieron, qué sigue.

Tu asistente del workspace **lee estas notas automáticamente** cuando te ayuda con ese cliente, y puede **actualizarlas** a medida que aprende más — así la memoria de la cuenta se mantiene al día sin que tengas que hacerlo a mano. Los admins editan a mano; todo el equipo puede leer.

Encontralas en **Admin → Compartir → [cliente] → Notes about this client**.

## Facturación

Las personas externas son **USD 0 e ilimitadas**. Tu factura cuenta solo miembros internos; la página de billing muestra a los externos en una línea aparte "incluidos". Si tu plan vence, los clientes siguen leyendo lo que ya compartiste — solo se pausa crear shares nuevos hasta que vuelvas a Teams.

<Aside type="tip">¿Solo necesitás mandar un artefacto a unos pocos emails externos? El flujo gratuito de [colaboradores](/es/everyone/collaborators/) sigue funcionando. Clientes agrega agrupación, un portal, marca, API acotada y recibos encima.</Aside>
