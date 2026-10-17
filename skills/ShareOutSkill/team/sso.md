# Workspace SSO (Okta, Entra ID, any OIDC IdP)

A workspace can sign its people in through its own identity provider over OpenID
Connect. Okta and Microsoft Entra ID are tested; Auth0 and other OIDC providers use the
same fields. Load [SKILL.md](SKILL.md) first.

Not the same thing as **Sign in with Microsoft** on the login page: that is one
instance-wide app the operator registers (`MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`,
see `deploy/cloudflare.md`) and it lets anyone with a Microsoft account sign in. Workspace
SSO is the customer's own Entra tenant, scoped to the workspace's email domains.

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

## 1b. Or create the app in Microsoft Entra ID

Done by the customer's Entra admin (Application Developer or above), in the
[Microsoft Entra admin center](https://entra.microsoft.com):

1. **Entra ID → App registrations → New registration.** Name it (people see it).
   **Supported account types: Single tenant only.** Register.
2. **Overview:** copy the **Application (client) ID** and the **Directory (tenant) ID**.
3. **Authentication → Add Redirect URI → Web:** `$SHAREOUT_BASE_URL/auth/sso/callback`.
4. **Certificates & secrets → Client secrets → New client secret.** Copy the secret
   **Value** (not the Secret ID); it is shown once. Note the expiry and rotate before it.
5. **Token configuration → Add optional claim → ID:** tick `email` and `xms_edov`
   (accept the prompt to add the Microsoft Graph `email` permission). If `xms_edov` is not
   offered, add it under **Manifest** → `optionalClaims.idToken`:
   `{ "name": "xms_edov", "essential": false }`.
6. Optional: **Enterprise apps →** the app **→ Properties → Assignment required = Yes**,
   then **Users and groups** to choose who may use ShareOut.

**Issuer:** `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0`. ShareOut
refuses `common`, `organizations`, `consumers` and domain-name tenants here: a workspace
IdP must be one tenant, or any Microsoft tenant could assert addresses on its domains.

**Email trust:** Entra does not verify the `email` claim (a user's mail attribute can hold
any address), so an Entra sign-in is accepted only when the ID token carries
`xms_edov` = true, Microsoft's flag that the address's domain is verified in the tenant —
then it must still be on `email_domains`. Users without a mailbox have no `email`; give
them one or they cannot sign in.

**Groups / roles:** not read. Everyone who signs in joins as `member`; promote people in
ShareOut. Restrict who can sign in with **Assignment required** (step 6).

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

For Entra, `"issuer": "https://login.microsoftonline.com/<tenant-id>/v2.0"`,
`"client_id"` = the Application (client) ID, and `"button_label": "Sign in with Microsoft"`.

- On `https://{workspace}.{apex}/auth/login` a **Sign in with Okta** button sits above
  the other methods. `/auth/sso?workspace={slug}` starts it from anywhere.
- First SSO sign-in creates the account (even with sign-ups paused) and adds the person
  to the workspace as a member.
- Only addresses on `email_domains` are accepted, whatever the IdP returns.

## SSO-only (`"enforced": true`)

Addresses on the workspace's domains must use SSO everywhere on the instance: password,
email code, Google and Microsoft sign-in are refused with code `SSO_REQUIRED`, and the login page
forwards them to the IdP (`redirect_url`). The workspace subdomain's login page shows
only the SSO button.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Okta shows its own `400 access_denied` page; ShareOut's callback is never hit | Okta's app sign-on policy denied the user. System Log reads "policy requirements could not be satisfied by the users' current set of available authenticator enrollments" (Catch-all Rule → DENY) | Customer's Okta admin: app → **Sign On** → authentication policy that the users can satisfy, or a rule allowing their enrolled authenticators |
| Okta says the user is not assigned to the client application | No assignment | App → **Assignments** → assign the people or groups |
| Save returns `ISSUER_UNREACHABLE` / issuer mismatch | `-admin` console URL used as issuer | Use `https://{org}.okta.com`, without `-admin` |
| Save says "use the tenant-specific v2.0 issuer" | Entra issuer with `common` / `organizations` / a domain, or without `/v2.0` | `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0` |
| Entra: "did not confirm this email address … xms_edov" | Optional claim missing, or the address's domain is not verified in the tenant | Step 5 above; verify the domain under **Entra ID → Domain names** |
| Entra: "did not share an email address" | User has no mail attribute / mailbox, or `email` optional claim missing | Give the user a mail address; add the `email` optional claim |
| Microsoft shows `AADSTS50011` (redirect URI mismatch) | Redirect URI not registered as **Web** | Step 3, exactly `$SHAREOUT_BASE_URL/auth/sso/callback` |
| Microsoft shows `AADSTS7000215` (invalid client secret) | Secret ID pasted instead of the Value, or it expired | New secret; `PUT` with the new `client_secret` |
