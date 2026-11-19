---
title: Ponelo en piloto automático
description: Tu artefacto puede hacer cosas solo — mandar un reporte semanal, postear a Slack cuando alguien se anota, actualizar tus datos todas las mañanas.
---

Tu artefacto puede hacer cosas **solo** — sin nadie ahí apretando botones. Lo configurás una vez, y funciona nomás.

## Desde el artefacto mismo

Cuando estás viendo un artefacto que podés administrar, la barra de herramientas tiene un
botón de **programar**. Elegí email, Slack o Telegram, definí cada cuánto, y ShareOut crea
el job por vos — sin llamadas a la API. Los owners y editores pueden programar envíos a
otras personas; los viewers pueden suscribirse para recibir el artefacto en su propio mail de
forma recurrente.

La pestaña **Automatizar** del Inspector en Inicio (en el celular: **Opciones → Automatizar**)
empieza con **Actualizar los datos** — desde Google Drive, un enlace o mandando el Excel por email —
y lista solo los schedules del artefacto que estás mirando. Owners y editores ven los schedules compartidos y sus propios envíos
personales; la suscripción personal de otra persona (un email o DM a sí misma) queda
privada.

## Dos formas de arrancar

**En un horario** — todas las mañanas, todos los lunes, el primero de cada mes:

> *"Todos los lunes a las 9, mandame por mail las inscripciones nuevas de la semana."*
>
> *"Todas las mañanas, actualizá mi lista de productos desde la planilla."*

**Cuando pasa algo** — entra una respuesta, se actualiza tu artefacto, alguien deja un comentario:

> *"Cuando alguien envía el formulario de RSVP, posteá su nombre en nuestro canal de Slack."*
>
> *"Cuando actualizo la página, mandales por mail la nueva versión a mis suscriptores."*

## Qué puede hacer

| Puede… | Por ejemplo |
| --- | --- |
| **Mandar mails** | Un reporte semanal, un resumen, un aviso |
| **Postear a Slack** | Un resumen, una captura o un PDF a tu canal |
| **Postear a Discord** | Avisar a tu servidor de la comunidad |
| **Actualizar tus datos** | Traer lo último de tu planilla o tu tienda — mirá [Mantené un artefacto al día desde una planilla](/es/everyone/google-sheets/#mantené-un-artefacto-al-día-desde-una-planilla) |
| **Avisar a otra app** | Mandar una señal a una herramienta que usás |

## Ejemplos reales

- **Un dueño de tienda:** todos los lunes, mandame por mail los pedidos de la semana pasada.
- **Un organizador de eventos:** cuando alguien confirma, postealo en el chat del equipo para llevar la cuenta.
- **Un equipo chico:** todas las mañanas, actualizá el tablero desde la planilla y posteá los números en Slack.
- **Un creador:** cuando publico una novedad, mandásela por mail a mi lista de suscriptores.

## Vos tenés el control

- **Pausalo** cuando quieras, o corrélo **ahora mismo** para probarlo.
- **Revisá qué pasó** — hay un registro simple de cada corrida, así ves que funcionó (o por qué no).

### Abrí una para ver y cambiar todo

Cada automatización tiene su propia página:

1. En la barra lateral, tocá **Automatizaciones**.
2. Tocá la automatización que querés. Su página muestra **Qué hace**, **Cuándo corre** y su
   **Historial de corridas**.
3. Para cambiarla, tocá **Editar** — podés cambiar el nombre, cuándo corre, a quién le llega y
   más — y después **Guardar cambios**. **Ejecutar ahora** la prueba en el momento; **Eliminar**
   la borra.

Si una corrida del **Historial de corridas** dice **Falló**, arreglá lo que indica (muchas veces
un email o un Slack o una planilla desconectados) y tocá **Ejecutar ahora** para ver que vuelve a
andar.

Los admins del workspace también ven **Tareas con IA** en la barra lateral. Cada tarea con IA abre
el mismo tipo de página, donde además podés cambiar sus **Instrucciones**, el **Modelo**, y sus
**Pasos máximos** y **Presupuesto por corrida (US$)**.

:::tip[Empezá de a poco]
Elegí una cosa que hacés a mano todas las semanas — mandar un reporte, copiar números, avisarle al equipo — y dejá que tu artefacto lo haga en tu lugar.
:::

## Qué sigue

- [**Conectá tus herramientas**](/es/everyone/connect/) — las automatizaciones rinden más cuando tus datos y Slack están conectados.
- [**Trabajen juntos**](/es/everyone/collaborators/) — sumá compañeros para ayudar a manejar las cosas.
