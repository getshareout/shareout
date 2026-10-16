---
title: Homepage del workspace
description: Qué ven los visitantes en {workspace}.shareout.site — gate de membresía y URLs de artefactos.
---

Cuando un [subdominio personalizado](/es/teams/subdomain/) está habilitado,
`{workspace}.shareout.site` se comporta distinto en la **raíz** vs las **rutas de artefacto**.

## Raíz del subdominio (`/`)

La raíz del workspace **nunca es una galería pública**. Está restringida a miembros:

| Visitante | Qué pasa |
| --- | --- |
| **Miembro del workspace** | Redirección a Home con este workspace (`/home?workspace=…`) |
| **Sesión iniciada, sin membresía** | Página "este workspace es privado" con opción de cambiar de cuenta |
| **Anónimo** | Redirección a iniciar sesión, volviendo a este subdominio tras OAuth |

Los workspaces son superficies cerradas — solo los miembros llegan al dashboard desde la raíz.

## URLs de artefactos

Los artefactos individuales siguen compartiéndose en URLs limpias del subdominio:

```
https://{workspace}.shareout.site/{artifact-slug}/
```

Los artefactos con visibilidad `workspace` o `public` publicados en el workspace son
accesibles aquí (según la visibilidad y política de acceso de cada artefacto). Los
privados requieren las reglas habituales de colaborador o acceso.

## Alternativa con namespace

Si el subdominio no está habilitado, los artefactos del workspace también están en:

```
shareout.site/@{workspaceSlug}/{artifact-slug}/
```

## Relacionado

- [Subdominios](/es/teams/subdomain/)
- [Carpetas](/es/teams/folders/)
- [Workspaces](/es/teams/workspaces/)
