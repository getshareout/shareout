---
title: GitHub
description: Export artifact files to a GitHub repository for version control.
---

Push your artifact's published files to a GitHub repository. Tokens are stored
per artifact. Access via `sdk.github`.

## Quick start

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

## Methods

```typescript
authorize(returnUrl?): Promise<boolean>
isConnected(): Promise<boolean>
getStatus(): Promise<{ connected: boolean; username?: string; artifactId: string }>
disconnect(): Promise<void>
listRepos(options?): Promise<{ repos: Repo[]; page: number; perPage: number }>
export(options): Promise<ExportResult>
```

## export() options

| Field | Required | Description |
| --- | --- | --- |
| `repo` | One of `repo` or `newRepo` | Existing repo in `owner/repo` format |
| `newRepo.name` | One of `repo` or `newRepo` | Name for a new repo to create |
| `newRepo.description` | No | Repository description |
| `newRepo.private` | No | Private repo (default: `false`) |
| `branch` | No | Target branch (default: `main`) |
| `commitMessage` | No | Commit message (default: `"ShareOut export v{version}"`) |
| `includeReadme` | No | Generate a README with artifact info (default: `true`) |
| `pathPrefix` | No | Prefix for all file paths, e.g. `"dist/"` |

## REST endpoints

These endpoints are also available directly from agents or server code.

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/data/{artifactIdOrSlug}/github/auth-url` | GET | Returns a GitHub OAuth URL |
| `/v1/data/{artifactIdOrSlug}/github/token-status` | GET | Connection status and username |
| `/v1/data/{artifactIdOrSlug}/github/disconnect` | POST | Remove stored GitHub token |
| `/v1/data/{artifactIdOrSlug}/github/repos` | GET | List user's repositories |
| `/v1/data/{artifactIdOrSlug}/github/export` | POST | Export files to a repository |

`{artifactIdOrSlug}` accepts either `art_2ce7…` or a deployment slug like `my-site`.

## auth-url query parameters

| Parameter | Required | Description |
| --- | --- | --- |
| `return` | No | URL to redirect to after OAuth; callback appends `?github_connected=true` |

## Behavior notes

- Tokens are stored per artifact, not per ShareOut user.
- GitHub tokens do not expire unless revoked.
- OAuth scope is `repo` (full repository access).
- OAuth returns through `https://shareout.site/auth/callback`; ShareOut detects GitHub callbacks from the `state` parameter.

## Errors

| Code | Meaning |
| --- | --- |
| `GITHUB_NOT_CONNECTED` | No token stored — call `authorize()` first |
| `REPO_NOT_FOUND` | Repository not found or not accessible |
| `NO_DEPLOYMENT` | No published version exists to export |
| `NO_ASSETS` | No files found in the deployment |
| `INVALID_REQUEST` | Both `repo` and `newRepo` missing from export body |
| `EXPORT_ERROR` | GitHub API error during export |
