# GitHub Integration

Export ShareOut artifacts to GitHub repositories for version control and backup.

## Overview

ShareOut has an artifact-level GitHub OAuth flow. A user authorizes a GitHub account in the browser, ShareOut stores the resulting token for that artifact, and the artifact can then export its files to a GitHub repository.

Important behavior:

- Tokens are stored per artifact, not per ShareOut user.
- Public artifacts can use the simplified flow directly.
- Data routes accept either the real artifact id, such as `art_...`, or the production deployment slug.
- GitHub OAuth returns through `$ORIGIN/auth/callback`; ShareOut detects GitHub callbacks from the `state` parameter.
- The hosted SDK exposes the flow at `shareout.github`.
- GitHub tokens do not expire unless revoked.

## Agent Workflow

```text
1. Publish or identify an artifact.
2. Call GET /v1/data/{artifactIdOrSlug}/github/auth-url.
3. Open the returned GitHub OAuth URL in a browser, or use shareout.github.authorize().
4. GitHub redirects to /auth/callback with a ShareOut GitHub state payload.
5. ShareOut stores the token as that artifact's `github` row in connections.
6. Call POST /v1/data/{artifactIdOrSlug}/github/export to push files to a repo.
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/data/{artifactIdOrSlug}/github/auth-url` | GET | Returns a GitHub OAuth URL |
| `/auth/callback` | GET | Shared OAuth callback; GitHub callbacks are detected from `state` |
| `/v1/data/{artifactIdOrSlug}/github/token-status` | GET | Checks connection status and returns username |
| `/v1/data/{artifactIdOrSlug}/github/disconnect` | POST | Removes stored GitHub token |
| `/v1/data/{artifactIdOrSlug}/github/repos` | GET | Lists user's GitHub repositories |
| `/v1/data/{artifactIdOrSlug}/github/export` | POST | Exports artifact files to a GitHub repository |

`{artifactIdOrSlug}` can be an artifact id like `art_2ce7...` or a deployment slug like `my-site`.

## GET /github/auth-url

Returns a GitHub OAuth URL for the user to authorize repository access for the artifact.

Query parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `return` | No | URL to redirect to after OAuth completes. The callback appends `?github_connected=true`. |

Response:

```json
{
  "success": true,
  "data": {
    "authUrl": "https://github.com/login/oauth/authorize?...",
    "message": "Open this URL in a browser to authorize GitHub access"
  }
}
```

The generated OAuth URL uses:

- `redirect_uri=$ORIGIN/auth/callback`
- `scope=repo`

Agent example:

```bash
curl "$ORIGIN/v1/data/my-artifact-slug/github/auth-url"
```

## GET /github/token-status

Checks whether the artifact has a stored GitHub token.

Response:

```json
{
  "success": true,
  "data": {
    "connected": true,
    "username": "octocat",
    "artifactId": "art_abc123"
  }
}
```

If not connected:

```json
{
  "success": true,
  "data": {
    "connected": false,
    "artifactId": "art_abc123"
  }
}
```

## POST /github/disconnect

Removes the stored GitHub token for the artifact.

Response:

```json
{
  "success": true,
  "data": {
    "success": true
  }
}
```

## GET /github/repos

Lists repositories accessible to the connected GitHub account.

Query parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `page` | No | Page number (default: 1) |
| `per_page` | No | Results per page (default: 30) |

Response:

```json
{
  "success": true,
  "data": {
    "repos": [
      {
        "name": "my-site",
        "full_name": "octocat/my-site",
        "private": false,
        "html_url": "https://github.com/octocat/my-site",
        "default_branch": "main"
      }
    ],
    "page": 1,
    "perPage": 30
  }
}
```

Error if not connected:

```json
{
  "success": false,
  "error": "GitHub not connected. Get auth URL from /github/auth-url first.",
  "code": "GITHUB_NOT_CONNECTED"
}
```

## POST /github/export

Exports the artifact's published files to a GitHub repository.

Request body:

```json
{
  "repo": "octocat/my-site",
  "commitMessage": "Update from ShareOut",
  "branch": "main",
  "includeReadme": true,
  "pathPrefix": ""
}
```

Or create a new repository:

```json
{
  "newRepo": {
    "name": "my-new-site",
    "description": "Published via ShareOut",
    "private": false
  },
  "commitMessage": "Initial export from ShareOut"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `repo` | One of `repo` or `newRepo` | Existing repository in `owner/repo` format |
| `newRepo.name` | One of `repo` or `newRepo` | Name for new repository to create |
| `newRepo.description` | No | Repository description |
| `newRepo.private` | No | Whether the repository is private (default: false) |
| `branch` | No | Target branch (default: main) |
| `commitMessage` | No | Commit message (default: "ShareOut export v{version}") |
| `includeReadme` | No | Generate README.md with artifact info (default: true) |
| `pathPrefix` | No | Prefix for all file paths (e.g., "dist/") |

Response:

```json
{
  "success": true,
  "data": {
    "success": true,
    "repoUrl": "https://github.com/octocat/my-site",
    "repo": "octocat/my-site",
    "branch": "main",
    "filesCommitted": 3,
    "files": ["index.html", "styles.css", "README.md"],
    "commitSha": "abc123def456",
    "version": 5
  }
}
```

Errors:

- `GITHUB_NOT_CONNECTED` (401): No GitHub token stored
- `INVALID_REQUEST` (400): Missing both `repo` and `newRepo`
- `REPO_NOT_FOUND` (404): Specified repository not found or not accessible
- `NO_DEPLOYMENT` (404): No published version exists
- `NO_ASSETS` (404): No files in the deployment
- `EXPORT_ERROR` (500): GitHub API error during export

## SDK Usage

The hosted SDK at `$ORIGIN/sdk/shareout.js` provides the `shareout.github` namespace.

### shareout.github.authorize(returnUrl?)

Opens a popup for GitHub OAuth. Returns a promise that resolves to `true` on success or `false` on failure.

```javascript
const sdk = new ShareOut();
const connected = await sdk.github.authorize();
if (connected) {
  console.log('GitHub connected!');
}
```

### shareout.github.isConnected()

Returns `true` if the artifact has a stored GitHub token.

```javascript
const connected = await sdk.github.isConnected();
```

### shareout.github.getStatus()

Returns connection status with username.

```javascript
const status = await sdk.github.getStatus();
// { connected: true, username: "octocat", artifactId: "art_..." }
```

### shareout.github.disconnect()

Removes the stored GitHub token.

```javascript
await sdk.github.disconnect();
```

### shareout.github.listRepos(options?)

Lists accessible repositories.

```javascript
const result = await sdk.github.listRepos({ page: 1, perPage: 30 });
// { repos: [...], page: 1, perPage: 30 }
```

### shareout.github.export(options)

Exports artifact files to GitHub.

```javascript
// Export to existing repo
const result = await sdk.github.export({
  repo: 'octocat/my-site',
  commitMessage: 'Update site'
});

// Create new repo
const result = await sdk.github.export({
  newRepo: { name: 'my-new-site', private: false }
});

console.log(result.repoUrl);     // https://github.com/octocat/my-site
console.log(result.commitSha);   // abc123...
console.log(result.filesCommitted); // 3
```

## Complete Example

```html
<!DOCTYPE html>
<html>
<head>
  <script src="$ORIGIN/sdk/shareout.js"></script>
</head>
<body>
  <button id="connect">Connect GitHub</button>
  <button id="export" disabled>Export to GitHub</button>
  <div id="status"></div>

  <script>
    const sdk = new ShareOut();
    const connectBtn = document.getElementById('connect');
    const exportBtn = document.getElementById('export');
    const status = document.getElementById('status');

    async function checkStatus() {
      const { connected, username } = await sdk.github.getStatus();
      if (connected) {
        status.textContent = `Connected as @${username}`;
        connectBtn.disabled = true;
        exportBtn.disabled = false;
      }
    }

    connectBtn.onclick = async () => {
      const connected = await sdk.github.authorize();
      if (connected) checkStatus();
    };

    exportBtn.onclick = async () => {
      const result = await sdk.github.export({
        newRepo: { name: 'my-exported-site' }
      });
      status.textContent = `Exported to ${result.repoUrl}`;
    };

    checkStatus();
  </script>
</body>
</html>
```

## GitHub OAuth App Setup

To use GitHub integration, configure a GitHub OAuth App:

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Set Authorization callback URL to: `$ORIGIN/auth/callback`
4. Copy Client ID and Client Secret
5. Add to ShareOut worker secrets:
   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```
