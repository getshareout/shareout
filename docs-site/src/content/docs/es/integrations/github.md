---
title: GitHub
description: Exportá los archivos de tu artifact a un repositorio de GitHub para control de versiones.
---

Publicá los archivos publicados de tu artifact en un repositorio de GitHub. Los tokens se guardan
por artifact. Accedé vía `sdk.github`.

## Inicio rápido

```javascript
const sdk = await ShareOut.create();

if (!await sdk.github.isConnected()) {
  await sdk.github.authorize();
}

const result = await sdk.github.export({
  repo: 'octocat/my-site',
  commitMessage: 'Update from ShareOut',
});

console.log(result.repoUrl);       // https://github.com/octocat/my-site
console.log(result.filesCommitted); // 3
```

## Métodos

```typescript
authorize(returnUrl?): Promise<boolean>
isConnected(): Promise<boolean>
getStatus(): Promise<{ connected: boolean; username?: string; artifactId: string }>
disconnect(): Promise<void>
listRepos(options?): Promise<{ repos: Repo[]; page: number; perPage: number }>
export(options): Promise<ExportResult>
```

## Opciones de export()

| Campo | Requerido | Descripción |
| --- | --- | --- |
| `repo` | Uno de `repo` o `newRepo` | Repo existente en formato `owner/repo` |
| `newRepo.name` | Uno de `repo` o `newRepo` | Nombre para un nuevo repo a crear |
| `newRepo.description` | No | Descripción del repositorio |
| `newRepo.private` | No | Repo privado (por defecto: `false`) |
| `branch` | No | Rama destino (por defecto: `main`) |
| `commitMessage` | No | Mensaje de commit (por defecto: `"ShareOut export v{version}"`) |
| `includeReadme` | No | Generar un README con info del artifact (por defecto: `true`) |
| `pathPrefix` | No | Prefijo para todos los paths de archivos, ej. `"dist/"` |

## Endpoints REST

Estos endpoints también están disponibles directamente desde agentes o código del servidor.

| Endpoint | Método | Descripción |
| --- | --- | --- |
| `/v1/data/{artifactIdOrSlug}/github/auth-url` | GET | Devuelve una URL de OAuth de GitHub |
| `/v1/data/{artifactIdOrSlug}/github/token-status` | GET | Estado de conexión y nombre de usuario |
| `/v1/data/{artifactIdOrSlug}/github/disconnect` | POST | Eliminar el token de GitHub guardado |
| `/v1/data/{artifactIdOrSlug}/github/repos` | GET | Listar repositorios del usuario |
| `/v1/data/{artifactIdOrSlug}/github/export` | POST | Exportar archivos a un repositorio |

`{artifactIdOrSlug}` acepta tanto `art_2ce7…` como un slug de deployment como `my-site`.

## Parámetros de auth-url

| Parámetro | Requerido | Descripción |
| --- | --- | --- |
| `return` | No | URL a redirigir tras el OAuth; el callback agrega `?github_connected=true` |

## Comportamiento

- Los tokens se guardan por artifact, no por usuario de ShareOut.
- Los tokens de GitHub no expiran a menos que se revoquen.
- El scope de OAuth es `repo` (acceso completo al repositorio).
- El OAuth retorna por `https://shareout.site/auth/callback`; ShareOut detecta los callbacks de GitHub desde el parámetro `state`.

## Errores

| Código | Significado |
| --- | --- |
| `GITHUB_NOT_CONNECTED` | No hay token guardado — llamá a `authorize()` primero |
| `REPO_NOT_FOUND` | Repositorio no encontrado o no accesible |
| `NO_DEPLOYMENT` | No existe una versión publicada para exportar |
| `NO_ASSETS` | No se encontraron archivos en el deployment |
| `INVALID_REQUEST` | Faltan tanto `repo` como `newRepo` en el body de export |
| `EXPORT_ERROR` | Error de la API de GitHub durante la exportación |
