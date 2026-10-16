---
title: Workspace SSO
description: Sign a workspace's people in through its own identity provider (Microsoft Entra ID, Okta, any OIDC IdP).
---

A workspace can sign its people in through the company's own identity provider over
OpenID Connect (authorization code + PKCE). Microsoft Entra ID and Okta are tested; other
OIDC providers use the same fields.

This is different from **Sign in with Microsoft** on the login page. That button is one
instance-wide app (see [Secrets](/self-host/secrets/#sign-in-with-microsoft)) that any
Microsoft account can use. Workspace SSO is the customer's own tenant, limited to the
workspace's email domains, and it can be made the only way in.

## Who sets it up

- The **customer's IdP admin** registers ShareOut in their IdP and sends back three
  values: issuer, client ID and client secret.
- The **instance owner** attaches them to the workspace. A workspace admin cannot: the
  IdP asserts email addresses, so whoever configures it can sign in as anyone on those
  domains. Each domain belongs to at most one workspace's SSO.

The instance needs the `CREDENTIALS_KEY` secret; the client secret is stored encrypted
with it.

## Microsoft Entra ID: steps for the customer's admin

In the [Microsoft Entra admin center](https://entra.microsoft.com), as an Application
Developer or above:

1. **Entra ID → App registrations → New registration.** Name it (your people see this
   name). **Supported account types: Single tenant only.** Select **Register**.
2. On **Overview**, copy the **Application (client) ID** and the **Directory (tenant) ID**.
3. **Authentication → Add Redirect URI → Web**, and enter
   `https://<your ShareOut host>/auth/sso/callback` exactly. The same URI serves every
   workspace.
4. **Certificates & secrets → Client secrets → New client secret.** Copy the secret
   **Value** (not the Secret ID); Entra shows it once. Note the expiry date and send a new
   one before it lapses.
5. **Token configuration → Add optional claim → ID**, tick **`email`** and
   **`xms_edov`**, and accept the prompt to add the Microsoft Graph `email` permission.
   If `xms_edov` is not listed, open **Manifest** and add
   `{ "name": "xms_edov", "essential": false }` under `optionalClaims.idToken`.
6. Optional, to choose who may use ShareOut: **Entra ID → Enterprise apps →** the app
   **→ Properties → Assignment required: Yes**, then assign people or groups under
   **Users and groups**.

Send the instance owner:

| Field | Value |
| --- | --- |
| Issuer | `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0` |
| Client ID | the Application (client) ID |
| Client secret | the secret Value |
| Email domains | the domains your people sign in with, e.g. `acme.com` |

### Why these claims

- **`email`**: ShareOut identifies people by email address. Users without a mail
  attribute (no mailbox) get no `email` and cannot sign in until they have one.
- **`xms_edov`**: Entra does not verify the `email` claim; a user's mail attribute can
  hold any address. `xms_edov` is Microsoft's flag that the address's domain is verified
  in your tenant. ShareOut refuses an Entra sign-in without it, then still checks the
  address against the workspace's email domains.
- **Groups and app roles** are not read. Everyone who signs in joins as a member;
  promote people in ShareOut. Use **Assignment required** to limit who gets in.

### Issuer rules

ShareOut accepts only the tenant-specific v2.0 issuer. `common`, `organizations`,
`consumers` and domain-name tenants (`acme.onmicrosoft.com`) are refused: a multi-tenant
issuer would let any Microsoft tenant assert addresses on the workspace's domains, and a
domain-name authority publishes a GUID issuer that never matches. Tokens must come from
`https://login.microsoftonline.com/<tenant-id>/v2.0`, for your client ID, signed by a key
from that tenant's `/discovery/v2.0/keys`, unexpired, with the nonce ShareOut sent.

## Okta: steps for the customer's admin

1. Admin Console → **Applications → Create App Integration → OIDC - OpenID Connect →
   Web Application**.
2. Grant type **Authorization Code** (you can also require PKCE).
3. Sign-in redirect URI: `https://<your ShareOut host>/auth/sso/callback`.
4. **Assignments:** the people or groups who may use ShareOut.
5. Send the **Client ID**, **Client secret** and the issuer `https://<org>.okta.com`.

## Attach it to the workspace (instance owner)

```bash
curl -X PUT "$ORIGIN/v1/admin/workspaces/$WORKSPACE_ID/sso" \
  -H "Authorization: Bearer $SHAREOUT_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "issuer": "https://login.microsoftonline.com/<tenant-id>/v2.0",
    "client_id": "<application-client-id>",
    "client_secret": "<secret value>",
    "email_domains": ["acme.com"],
    "button_label": "Sign in with Microsoft",
    "enforced": false
  }'
```

The issuer's discovery document is fetched on save. `GET` reads the config (never the
secret), `PUT` again updates it (omit `client_secret` to keep the stored one), `DELETE`
removes it.

## What people see

- On the workspace subdomain's `/auth/login`, the SSO button sits above the other
  methods. `/auth/sso?workspace=<slug>` starts it from anywhere.
- The first SSO sign-in creates the account (even with sign-ups paused) and adds the
  person to the workspace as a member.
- **`"enforced": true`**: addresses on the workspace's domains must use SSO everywhere on
  the instance. Password, email code, Google and Microsoft sign-in send them to the IdP
  instead.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Save says "use the tenant-specific v2.0 issuer" | Use `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0` |
| "did not confirm this email address … xms_edov" | Add the `xms_edov` optional claim (step 5); verify the domain under **Entra ID → Domain names** |
| "did not share an email address" | Give the user a mail address; add the `email` optional claim |
| Microsoft shows `AADSTS50011` | Redirect URI missing or not registered as **Web** (step 3) |
| Microsoft shows `AADSTS7000215` | The Secret ID was sent instead of the Value, or the secret expired |
| Microsoft shows `AADSTS50105` | Assignment is required and the person is not assigned |
| Okta shows `400 access_denied` | The app's sign-on policy denied the person; adjust it in Okta |

Microsoft references:
[OpenID Connect on the identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc),
[validating tokens](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens#validate-tokens),
[ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference),
[optional claims (`email`, `xms_edov`)](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference).
