---
title: Plantillas
description: Guardá un artefacto o una carpeta entera como plantilla e instalala en cualquier espacio con un clic, sin llevarte los datos del espacio original.
---

¿Armaste algo para un equipo o cliente que otro también necesita? Guardalo como
**plantilla**. Quien pueda usarla la instala en su espacio con un clic y recibe su propia
copia, lista para conectar a sus datos.

## Guardar como plantilla

Abrí un artefacto y elegí **Guardar como plantilla** en su panel de detalles, o abrí una
carpeta y usá **Guardar como plantilla** en la barra de la carpeta. Antes de guardar ves:

- **Se incluye**: los artefactos y sus archivos (todas las páginas de un sitio con varias
  páginas), la estructura de carpetas y sus guías, y la *forma* de los datos: columnas de
  tablas y datasets, y qué fuentes de datos usa.
- **Queda afuera**: filas de tablas, contenido de datasets, valores guardados,
  comentarios, vistas, Conocimiento y credenciales. Las credenciales que aparezcan en el
  código se quitan solas.
- **Revisá antes de guardar**: lo que parezca personal o propio de tu espacio (emails,
  teléfonos, el nombre del espacio, personas). Marcá la casilla cuando lo revisaste, o
  editá el artefacto antes.

Podés guardar hasta cinco filas de ejemplo por tabla para que la copia no arranque vacía.

## Quién puede usar una plantilla

| Opción | Quién la puede instalar |
|---|---|
| Este espacio | Los miembros del espacio donde se creó |
| Compartida | También los espacios con los que la compartís (tenés que ser miembro) |
| Biblioteca | Todos los espacios de esta instancia de ShareOut: solo los admins de la instancia publican acá |

## Instalar

Abrí **Plantillas** en la barra lateral (o **Nuevo → Ver plantillas**), mirá la vista
previa y elegí **Instalar**. Elegí una carpeta y ShareOut:

- crea los artefactos (y las carpetas, si es una plantilla de carpeta): siempre copias
  nuevas, nunca encima de algo que ya tenés
- arregla los enlaces entre ellos para que apunten a tus copias
- crea las tablas y datasets vacíos, con las mismas columnas
- te muestra **Terminá de configurar**: las fuentes de datos a conectar (con el mismo
  nombre) y las tablas a cargar

## Actualizaciones

Cuando la plantilla tiene una versión nueva, sus artefactos instalados muestran **Hay una
actualización** en los detalles. **Revisar actualización** lista lo que cambia;
**Actualizar** le da a cada artefacto una versión nueva con los archivos de la plantilla.
Las versiones anteriores quedan en el Historial, así que podés restaurar cualquiera, y tus
datos no se tocan.

## Desde un agente o la API

Las herramientas MCP `list_templates`, `install_template` y `save_as_template` funcionan
desde Claude o ChatGPT, y la API REST está en `/v1/artifact-templates`: mirá la
[referencia de la API](/es/teams/api/).
