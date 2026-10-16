---
title: Historial de versiones y restauración
description: Mirá quién cambió tu artefacto, cómo y qué cambió, compará dos versiones cualquiera y recuperá una anterior sin perder nada.
---

Cada publicación crea una **versión** nueva de tu artefacto: v1, v2, v3… Nunca se pisa
nada. La pestaña **Historial** las muestra todas, y podés volver a poner en vivo
cualquier versión anterior con un clic.

## Abrí el Historial

Abrí el artefacto en [Home](/es/everyone/your-workspace/) y elegí **Historial** en el
Inspector. Cada versión muestra:

- **Quién** la publicó (o "Alguien" si no se sabe).
- **Cómo** se hizo: **Publicación** (API), **Agente**, **Editor** o **Restauración**.
- **Cuándo**, y la marca **En vivo** en la versión que la gente ve ahora.
- **Qué cambió**: una nota de una línea (mirá [Notas de cambios](#notas-de-cambios)).
- Cuántos **comentarios** y **aprobaciones** tuvo esa versión
  (mirá [Revisión y aprobaciones](/es/everyone/review/)).

El Historial lista las 50 versiones más recientes. Lo ven las personas con las que se
compartió el artefacto.

## Mirá qué cambió

Abrí **Qué cambió** en una versión para ver las diferencias línea por línea contra la
versión anterior. Las líneas agregadas y quitadas se resaltan; los tramos largos sin
cambios se pliegan en "N líneas sin cambios".

Para comparar dos versiones cualquiera, elegí una **Versión anterior** y una **Versión
más nueva** y tocá **Comparar**.

La comparación cubre el HTML principal del artefacto. Si el archivo es muy grande, se
compara solo el comienzo.

## Vista previa de una versión anterior

**Vista previa** abre una versión tal como era, en un sandbox. Los datos en vivo y el
inicio de sesión no corren en la vista previa: ves el artefacto en sí, no los números de
hoy.

## Restaurá una versión

**Restaurar vN** publica una versión **nueva** con el contenido de vN. No se borra nada:
todas las versiones, incluidas las posteriores a vN, quedan en el Historial, y la nueva
queda marcada "Restaurada desde vN". Si te arrepentís, restaurá la versión de la que
venías.

Para restaurar necesitás **Puede editar** en el artefacto (o ser su dueño, o owner/admin
del workspace). Si el artefacto tiene pruebas, la versión restaurada se publica cuando
pasan.

:::note[Rollback está deprecado]
La API anterior de "rollback a la versión previa" sigue funcionando, pero está deprecada.
Usá restaurar: puede recuperar cualquier versión, no solo la última, y conserva el
historial. Mirá la [referencia de la API](/api/).
:::

## Notas de cambios

Cuando publicás desde la API o desde una app de IA conectada a ShareOut, podés mandar un
`message` opcional que diga qué cambiaste. Aparece junto a esa versión en el Historial.

Cuando una versión se publica sin nota, ShareOut escribe por vos una nota de una línea
sobre "qué cambió", a partir de las diferencias con la versión anterior. Esas notas
llevan la marca **IA** en el Historial, para distinguirlas de las que escribió una
persona. Las primeras versiones, las restauraciones y las publicaciones que no cambiaron
el artefacto no reciben nota de IA.

La nota de la versión en vivo también aparece en **Detalles** como
"Actualizado &lt;fecha&gt;: &lt;nota&gt;".

Las notas de IA dependen de la función **Version change notes** (`ai.version_summaries`,
activada por defecto), que figura en **Admin → Funciones**. Los admins del workspace la
ven ahí; el admin de la instancia la activa o desactiva por workspace. También necesitan
un proveedor de IA configurado en la instancia.

## Qué sigue

- [**Revisión y aprobaciones**](/es/everyone/review/): comentá una versión y aprobala.
- [**Publicar artifacts**](/es/guides/publishing/): versiones, slugs y la API de publicación.
