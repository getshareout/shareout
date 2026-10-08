# Workspace SSO (Okta, any OIDC IdP)

A workspace can sign its people in through its own identity provider over OpenID
Connect. Okta is the tested IdP; Entra ID, Auth0 and other OIDC providers use the same
fields. Load [SKILL.md](SKILL.md) first.

## Who can set it up

Only the **instance owner** (superadmin). The IdP asserts email addresses, and ShareOut
does not verify domain ownership, so a workspace admin cannot configure it. Each email
domain can belong to one workspace's SSO.

Requires the `CREDENTIALS_KEY` secret (the client secret is stored encrypted with it).

## 1. Create the app in Okta

1. Admin Console → **Applications → Create App Integration** → **OIDC - OpenID Connect**
   → **Web Application**.
2. Grant type: **Authorization Code**. PKCE is sent on every request, so you can also
   tick **Require PKCE as additional verification**.
3. **Sign-in redirect URI:** `$SHAREOUT_BASE_URL/auth/sso/callback`
   (local: `http://localhost:55162/auth/sso/callback`). One URI serves every workspace
   and subdomain.
4. **Assignments:** the people or groups who may use ShareOut.
5. Copy the **Client ID** and **Client secret** (General → Client Credentials).

**Issuer:** use the org issuer, `https://{yourOktaDomain}`. A custom authorization
server (`https://{yourOktaDomain}/oauth2/default`) also works, but on an Integrator
Free Plan org the `default` server ships without an access policy; add a policy and rule
first or sign-in fails at Okta.

## 2. Attach it to the workspace

```bash
curl -X PUT "$ORIGIN/v1/admin/workspaces/$WORKSPACE_ID/sso" \
  -H "Authorization: Bearer $SHAREOUT_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "issuer": "https://acme.okta.com",
    "client_id": "0oa…",
    "client_secret": "…",
    "email_domains": ["acme.com"],
    "button_label": "Sign in with Okta",
    "enforced": false
  }'
```

The issuer's discovery document is fetched on save; an unreachable or mismatched issuer
is a 400. The response includes `redirect_uri` and a ready `sign_in_url`.

- `GET` the same path to read it (the secret is never returned).
- `PUT` again to change it; omit `client_secret` to keep the stored one.
- `DELETE` to remove it.

## What people see

- On `https://{workspace}.{apex}/auth/login` a **Sign in with Okta** button sits above
  the other methods. `/auth/sso?workspace={slug}` starts it from anywhere.
- First SSO sign-in creates the account (even with sign-ups paused) and adds the person
  to the workspace as a member.
- Only addresses on `email_domains` are accepted, whatever the IdP returns.

## Okta-only (`"enforced": true`)

Addresses on the workspace's domains must use SSO everywhere on the instance: password,
email code and Google sign-in are refused with code `SSO_REQUIRED`, and the login page
forwards them to the IdP (`redirect_url`). The workspace subdomain's login page shows
only the SSO button.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Okta shows its own `400 access_denied` page; ShareOut's callback is never hit | Okta's app sign-on policy denied the user. System Log reads "policy requirements could not be satisfied by the users' current set of available authenticator enrollments" (Catch-all Rule → DENY) | Customer's Okta admin: app → **Sign On** → authentication policy that the users can satisfy, or a rule allowing their enrolled authenticators |
| Okta says the user is not assigned to the client application | No assignment | App → **Assignments** → assign the people or groups |
| Save returns `ISSUER_UNREACHABLE` / issuer mismatch | `-admin` console URL used as issuer | Use `https://{org}.okta.com`, without `-admin` |
