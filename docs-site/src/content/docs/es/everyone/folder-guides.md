---
title: Guías de carpeta
description: Dale a una carpeta una guía breve — qué va en ella y cómo construir para ella — y las personas y los agentes de IA que trabajan ahí la siguen.
---

Una carpeta en ShareOut no es solo un lugar donde soltar páginas. Puede llevar una **guía**: una nota corta que dice qué va en la carpeta y cómo debe construirse lo que vive ahí. Las personas la leen cuando abren la carpeta — y también los agentes de IA que construyen tus páginas.

Pensala como las reglas de la casa de esa carpeta.

## Para qué sirve

Cuando vos (o un agente) hacen una página nueva dentro de una carpeta, la guía es el contexto que mantiene todo consistente:

- **Audiencia** — "esto es para ejecutivos" vs "esto es para clientes".
- **Aspecto** — "usá los colores de marca, sin gradientes genéricos".
- **Datos** — "tomá los números del dataset `sales`".
- **Reglas** — "mantené privado hasta que alguien revise".

Sin guía, cada página arranca de cero. Con una, la carpeta misma recuerda cómo debe verse su trabajo.

## Agregar una guía

Abrí una carpeta en **Home → Todos los artefactos**. Arriba vas a ver **Agregar guía de carpeta** (si podés administrar la carpeta). Hacé clic, escribí unas líneas en Markdown y guardá.

```markdown
# Campaña Q3

Las páginas de acá son para la revisión de liderazgo.

- Audiencia: ejecutivos — lenguaje claro, sin jerga
- Solo paleta de marca, gráficos en SVG
- Fuente: el dataset `sales`
- Mantener privado hasta revisar
```

Editala o borrala cuando quieras con el lápiz en la guía.

## Quién puede editarla

- **Carpetas personales** — vos, el dueño.
- **Carpetas de Team Space** — dueños y admins del espacio. Todo el equipo ve la guía; mantiene alineado a todo el equipo (y a sus agentes).

## Funciona para los agentes

Este es el punto. Cuando un agente de IA edita una página que vive en una carpeta con guía, ShareOut le entrega la guía automáticamente — así construye según tus convenciones sin que las repitas cada vez. Los agentes que publican por la API también pueden leer la guía de una carpeta.

## Relacionado

- [Tu workspace (Home)](/es/everyone/your-workspace/) — carpetas y el diseño de Home
- [Sumá un asistente](/es/everyone/assistant/) — IA dentro de una página
