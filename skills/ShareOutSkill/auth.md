# ShareOut Authentication

## Overview

ShareOut uses token-based authentication for all API operations. This is a fully headless system - no email required, no OAuth flows for the SDK user. Claude handles all authentication seamlessly.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    First-Time Setup                         │
├─────────────────────────────────────────────────────────────┤
│  1. Claude calls POST /v1/auth/create-account               │
│  2. Server creates user + returns token (so_xxx...)         │
│  3. Claude stores token in ~/.shareout/credentials          │
│  4. All future requests use: Authorization: Bearer so_xxx   │
└─────────────────────────────────────────────────────────────┘
```

## Token Format

Tokens are prefixed with `so_` followed by 64 hex characters:

```
so_a1b2c3d4e5f6...
```

- Generated using `crypto.getRandomValues()` (32 bytes)
- SHA-256 hashed before storage in database
- Never expires by default (can set `expires_at`)

## Credential Storage

Store credentials locally at `~/.shareout/credentials`:

```json
{
  "token": "so_abc123...",
  "user_id": "usr_xyz789",
  "created_at": "2024-01-15T10:00:00Z"
}
```

## Log in with Google (device login)

For a user who **already has a ShareOut account** — most importantly one **invited to a workspace by email** — anonymous `create-account` is wrong: it would strand them in a fresh headless account instead of their real one. Device login signs them in as themselves via Google and returns an `so_` token to the CLI.

```
┌──────────────────────────────────────────────────────────────────┐
│  1. CLI  → POST /v1/auth/device/start        (no auth)            │
│           ← { device_code, user_code, verification_uri_complete } │
│  2. User → opens verification_uri_complete, signs in with Google  │
│           server verifies email, mints so_ token, binds to code   │
│  3. CLI  → POST /v1/auth/device/token { device_code }  (poll)     │
│           ← { status: "approved", token: "so_…" }                 │
│  4. CLI  → save token to ~/.shareout/credentials                  │
└──────────────────────────────────────────────────────────────────┘
```

- The `device_code` is the secret held by the CLI; the `user_code` is the short code shown in the browser. Never send `device_code` to the user.
- Codes expire in 10 minutes. Poll no faster than the returned `interval` (5s). The token is delivered **once** — the pending row is consumed on the first approved poll.
- Because Google verifies the email, `upsertUser` adopts the existing account for that email (the invited user's), rather than creating a duplicate.
- **`expected_email`** (optional, sent to `device/start`): the email the user expects to sign in as — e.g. the address they were invited under. It is passed to Google as `login_hint` so the correct account is **pre-selected** (prevents wrong-account picks), and it drives the mismatch warn.
- **`warn`** in the approved response fires only when `expected_email` was set *and* the user signed in as a different email. It is precise — a plain new signup with no `expected_email` never warns. On `warn`, confirm with the user before saving the token; offer to restart with the right account.
- **Copy-paste fallback:** the browser success page shows the token, so a user can paste it manually when the CLI cannot poll.

### `POST /v1/auth/device/start`

No auth. Optional body `{ "expected_email" }`. → `201 { device_code, user_code, verification_uri, verification_uri_complete, interval, expires_in }`.

### `POST /v1/auth/device/token`

No auth. Body `{ "device_code" }`.

- Pending → `200 { "status": "pending", "interval": 5 }`
- Approved → `200 { "status": "approved", "token": "so_…", "user_id": "usr_…", "warn"? }`
- Expired / denied / unknown → `400 { "error": "expired_token" | "access_denied" | "invalid_grant" }`

## API Endpoints

### Create Account

Creates a new anonymous account. No email required.

```http
POST /v1/auth/create-account
Content-Type: application/json
```

**Response (201):**
```json
{
  "token": "so_a1b2c3d4e5f6789...",
  "user_id": "usr_abc123"
}
```

This is the only unauthenticated endpoint. All others require the Bearer token.

---

### Self-Serve API Tokens

Signed-in users can list and mint their own API tokens from the home UI (avatar menu → **API token**) or via REST. Plaintext is shown **once** at creation and never stored recoverably.

```http
GET /v1/me/tokens
Authorization: Bearer so_xxx
```

**Response (200):**

```json
{
  "ok": true,
  "count": 1,
  "tokens": [
    { "id": "tok_abc", "name": "self-serve", "created_at": "2026-06-17T10:00:00Z", "last_used_at": "2026-06-17T11:00:00Z" }
  ]
}
```

```http
POST /v1/me/tokens
Authorization: Bearer so_xxx
Content-Type: application/json

{ "regenerate": true }
```

**Response (200):**

```json
{
  "ok": true,
  "token": "so_newtoken…",
  "shown_once": true
}
```

- Omit `regenerate` (or set `false`) to **add** a token alongside existing ones.
- Set `"regenerate": true` to revoke all existing tokens first, then mint exactly one new token.
- Session cookies (`credentials: 'include'`) work instead of Bearer for browser calls from the home UI.

Store the returned `token` in `~/.shareout/credentials` for agent/CLI use.

---

### Get Profile

Retrieve user profile information.

```http
GET /v1/auth/profile
Authorization: Bearer so_xxx
```

**Response (200):**
```json
{
  "id": "usr_abc123",
  "email": null,
  "username": "myuser",
  "name": "My Display Name",
  "metadata": {
    "company": "Acme Inc",
    "role": "developer"
  },
  "created_at": "2024-01-15T10:00:00Z"
}
```

---

### Update Profile

Update username, name, or custom metadata.

```http
PUT /v1/auth/profile
Authorization: Bearer so_xxx
Content-Type: application/json

{
  "username": "newuser",
  "name": "New Name",
  "metadata": {
    "company": "New Company",
    "custom_field": "any value"
  }
}
```

**Response (200):** Returns updated profile.

**Validation:**
- `username`: 3-32 chars, alphanumeric + underscore only, lowercase
- `name`: Any string, optional
- `metadata`: Any JSON object

**Error Codes:**
- `INVALID_USERNAME` (400): Invalid format
- `USERNAME_TAKEN` (409): Already in use

---

### Link Email (Optional)

Optionally associate an email with the account.

```http
POST /v1/auth/link-email
Authorization: Bearer so_xxx
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "email": "user@example.com"
}
```

**Error Codes:**
- `INVALID_EMAIL` (400): Invalid email format
- `EMAIL_IN_USE` (409): Email already linked to another account

---

### Linked Accounts

Signed-in users can link multiple Google identities into one Home grid. Linked accounts share the same artifact catalog, folders, and edit rights — an artifact owned by any linked account is editable as **owner** from any linked session.

```http
GET /v1/auth/linked-accounts
Cookie: shareout_session=…
```

**Response (200):**

```json
{
  "accounts": [
    { "id": "usr_abc", "email": "work@company.com", "name": "Work", "is_primary": true },
    { "id": "usr_def", "email": "personal@gmail.com", "name": "Personal", "is_primary": false }
  ]
}
```

Link another account: `GET /v1/auth/link-google` (session) with `redirect` back to Home.

```http
DELETE /v1/auth/linked-accounts/{userId}
Cookie: shareout_session=…
```

Unlinks a non-primary account. The primary account cannot be unlinked while others remain.

Linked-account scope also applies to Telegram/Slack bots ("search across every page your linked accounts can access") and personal folder visibility.

---

## Rate Limiting

All authenticated endpoints track usage per user:

| Action | Limit | Window |
|--------|-------|--------|
| `publish` | 100 | 24 hours |

### Rate Limit Headers

Responses include:
```
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705420800
```

### Rate Limit Exceeded (429)

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "remaining": 0,
  "reset": 1705420800
}
```

---

## Token Lifecycle

### Creation
- Created via `/v1/auth/create-account`
- One token per account by default (named "default")

### Usage Tracking
- `last_used_at` updated on each API call
- Helps identify inactive tokens

### Expiration
- Optional `expires_at` field
- Tokens without expiration never expire
- Expired tokens return `401 Unauthorized`

---

## Security Model

### Collaborator Roles

Artifacts have role-based access control:

| Role | Permissions |
|------|-------------|
| **owner** | Full control: view, edit, publish, manage collaborators, delete, transfer ownership |
| **editor** | Edit metadata, publish new versions, rollback, add/remove editors and viewers |
| **viewer** | View private artifacts only |

### What's Protected by Role

| Endpoint | Owner | Editor | Viewer |
|----------|-------|--------|--------|
| `POST /v1/publish` (existing artifact) | ✓ | ✓ | ✗ |
| `GET /v1/artifacts/:id` | ✓ | ✓ | ✓ |
| `PATCH /v1/artifacts/:id` | ✓ | ✓ | ✗ |
| `DELETE /v1/artifacts/:id` | ✓ | ✗ | ✗ |
| `GET /v1/artifacts/:id/collaborators` | ✓ | ✓ | ✓ |
| `POST /v1/artifacts/:id/collaborators` | ✓ | ✓ | ✗ |
| `DELETE /v1/artifacts/:id/collaborators/:email` | ✓ | ✓ | ✗ |
| `POST /v1/artifacts/:id/transfer-ownership` | ✓ | ✗ | ✗ |
| `GET /v1/artifacts/:id/versions` | ✓ | ✓ | ✓ |
| `POST /v1/artifacts/:id/rollback` | ✓ | ✓ | ✗ |

### What's Not Protected

- Viewing public artifacts (`/a/:slug/`)
- Health check (`/health`)
- Root info endpoint (`/`)

### Token Storage Best Practices

1. **Never commit tokens** to version control
2. **Use `~/.shareout/credentials`** for local development
3. **Environment variables** for CI/CD:
   ```bash
   export SHAREOUT_TOKEN="so_xxx"
   ```
4. **Secure file permissions**:
   ```bash
   chmod 600 ~/.shareout/credentials
   ```

---

## Workspace Visibility

An artifact in a Teams workspace can be set to `visibility: 'workspace'` — accessible to the **owner, collaborators, and every member of that workspace** (verified via workspace membership, no per-person `share_with` needed). This is distinct from `private`, which stays owner + explicitly-shared only **even when the artifact lives in a workspace**. Setting `workspace` requires the artifact to belong to a workspace.

Access enforcement is uniform across the serve path, raw/text serve, embeds, and the data API (`/v1/data/…` grants workspace members read access, subject to any row-level `access_policy`). Embeds of `workspace` (and `private`) artifacts are blocked — only `public` artifacts can be embedded on external sites.

## Viewer Authentication (Separate)

For **private artifacts**, viewers authenticate differently:

### Google OAuth or email one-time code

For artifacts with `share_with` emails and `auth_method: "google"` (the default for email-gated private pages):

- Viewers open the artifact login page and choose **Sign in with Google** **or** enter their email for a **6-digit one-time code**.
- The email must match the artifact's collaborator list (populated from `share_with` at publish time).
- Both paths mint a `shareout_session` cookie; the Worker resolves the verified email the same way for row-level `access_policy`.

**Email OTP flow (browser or API):**

```http
POST /v1/auth/email/start
Content-Type: application/json

{ "email": "viewer@company.com" }
```

```http
POST /v1/auth/email/verify
Content-Type: application/json

{ "email": "viewer@company.com", "code": "123456" }
```

**Response (200):** `{ "ok": true, "user": { "email": "viewer@company.com" } }` plus `Set-Cookie: shareout_session=…`.

Codes expire in **10 minutes**. Rate limits: 30s between sends to the same email, max **6 codes/hour**. After verify, reload the artifact URL (the login page does this automatically).

Use email OTP when viewers cannot or prefer not to use Google OAuth. For programmatic account linking (signed-in owner), use `POST /v1/auth/link-email/start` and `POST /v1/auth/link-email/verify` instead.

### Password
- Single password for artifact
- Simple login form

### Credentials
- Username/password pairs
- Multiple users with different credentials

Password and credentials are an **alternative** way in for people with no ShareOut
account, not a second factor on top of a share. The owner and any named collaborator
who is signed in go straight through, and adding a collaborator no longer rewrites the
gate — an artifact published with `password` keeps it.

These are for artifact **viewers**, not artifact **owners**.

---

## Error Reference

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Token valid but no permission |
| `NOT_FOUND` | 404 | Resource not found |
| `INVALID_JSON` | 400 | Malformed JSON body |
| `INVALID_EMAIL` | 400 | Invalid email format |
| `INVALID_USERNAME` | 400 | Username doesn't match rules |
| `EMAIL_IN_USE` | 409 | Email belongs to another user |
| `USERNAME_TAKEN` | 409 | Username already exists |
| `RATE_LIMIT_EXCEEDED` | 429 | Daily limit reached |
| `NO_UPDATES` | 400 | Update request with no fields |

---

## SDK Usage

```typescript
// Initialize client
const shareout = new ShareOut();

// Check for existing credentials
const hasCredentials = await shareout.hasCredentials();

if (!hasCredentials) {
  // First-time setup
  const { token, user_id } = await shareout.createAccount();
  await shareout.saveCredentials(token);
}

// Get profile
const profile = await shareout.getProfile();

// Update profile
await shareout.updateProfile({
  username: "myuser",
  name: "My Name",
  metadata: { company: "Acme" }
});

// Optional: link email
await shareout.linkEmail("user@example.com");
```

---

## Database Schema

```sql
-- Users table (extended)
ALTER TABLE users ADD COLUMN username TEXT UNIQUE;
ALTER TABLE users ADD COLUMN metadata TEXT DEFAULT '{}';

-- Bearer tokens (personal and workspace-agent alike)
CREATE TABLE tokens (
    id TEXT PRIMARY KEY,
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user','workspace')),
    principal_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT 'default',
    scopes TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    expires_at TEXT,
    revoked_at TEXT
);

-- Rate limiting
CREATE TABLE rate_limits (
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user','artifact')),
    principal_id TEXT NOT NULL,
    action TEXT NOT NULL,
    window_start TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (principal_type, principal_id, action, window_start)
);
```

---

## FAQ

**Q: Can I have multiple tokens?**
A: The schema supports it, but currently one token per user is created.

**Q: What if I lose my token?**
A: Create a new account. If email was linked, contact support.

**Q: Is email required?**
A: No. Email is optional and only used for account recovery.

**Q: Can tokens be revoked?**
A: Delete from the `tokens` table or wait for expiration.

**Q: How do I authenticate in CI/CD?**
A: Use `SHAREOUT_TOKEN` environment variable.
