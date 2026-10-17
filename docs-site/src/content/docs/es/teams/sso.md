---
title: SSO del workspace
description: Que la gente de un workspace entre con el proveedor de identidad de su empresa (Microsoft Entra ID, Okta, cualquier IdP OIDC).
---

Un workspace puede hacer que su gente inicie sesión con el proveedor de identidad de la
empresa, por OpenID Connect (authorization code + PKCE). Microsoft Entra ID y Okta están
probados; otros proveedores OIDC usan los mismos campos.

No es lo mismo que **Entrar con Microsoft** en la página de login. Ese botón es una sola
app para toda la instancia (ver [Secrets](/es/self-host/secrets/#entrar-con-microsoft)) que
puede usar cualquier cuenta de Microsoft. El SSO del workspace es el tenant del cliente,
limitado a los dominios de email del workspace, y puede ser la única forma de entrar.

## Quién lo configura

- El **admin del IdP del cliente** registra ShareOut en su IdP y devuelve tres datos:
  issuer, client ID y client secret.
- El **dueño de la instancia** los asocia al workspace. Un admin del workspace no puede:
  el IdP afirma direcciones de email, así que quien lo configura podría entrar como
  cualquiera de esos dominios. Cada dominio pertenece como mucho al SSO de un workspace.

La instancia necesita el secret `CREDENTIALS_KEY`; el client secret se guarda cifrado con él.

## Microsoft Entra ID: pasos para el admin del cliente

En el [centro de administración de Microsoft Entra](https://entra.microsoft.com), con rol
Application Developer o superior:

1. **Entra ID → App registrations → New registration.** Ponele un nombre (tu gente lo ve).
   **Supported account types: Single tenant only.** Elegí **Register**.
2. En **Overview**, copiá el **Application (client) ID** y el **Directory (tenant) ID**.
3. **Authentication → Add Redirect URI → Web**, y escribí exactamente
   `https://<tu host de ShareOut>/auth/sso/callback`. La misma URI sirve para todos los
   workspaces.
4. **Certificates & secrets → Client secrets → New client secret.** Copiá el **Value**
   del secret (no el Secret ID); Entra lo muestra una sola vez. Anotá el vencimiento y
   mandá uno nuevo antes de que caduque.
5. **Token configuration → Add optional claim → ID**, marcá **`email`** y **`xms_edov`**,
   y aceptá el aviso que agrega el permiso `email` de Microsoft Graph. Si `xms_edov` no
   aparece, abrí **Manifest** y agregá `{ "name": "xms_edov", "essential": false }` en
   `optionalClaims.idToken`.
6. Opcional, para elegir quién usa ShareOut: **Entra ID → Enterprise apps →** la app
   **→ Properties → Assignment required: Yes**, y asigná personas o grupos en
   **Users and groups**.

Mandale al dueño de la instancia:

| Campo | Valor |
| --- | --- |
| Issuer | `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0` |
| Client ID | el Application (client) ID |
| Client secret | el Value del secret |
| Dominios de email | los dominios con los que entra tu gente, por ejemplo `acme.com` |

### Por qué estos claims

- **`email`**: ShareOut identifica a las personas por su email. Los usuarios sin atributo
  mail (sin buzón) no reciben `email` y no pueden entrar hasta tener uno.
- **`xms_edov`**: Entra no verifica el claim `email`; el atributo mail de un usuario puede
  tener cualquier dirección. `xms_edov` es la marca de Microsoft de que el dominio de esa
  dirección está verificado en tu tenant. ShareOut rechaza un login de Entra sin esa marca,
  y además controla que la dirección esté en los dominios del workspace.
- **Grupos y app roles** no se leen. Todos los que entran se suman como miembros; los
  ascendés en ShareOut. Usá **Assignment required** para limitar quién entra.

### Reglas del issuer

ShareOut acepta solo el issuer v2.0 del tenant. Rechaza `common`, `organizations`,
`consumers` y tenants por nombre de dominio (`acme.onmicrosoft.com`): un issuer
multi-tenant dejaría que cualquier tenant de Microsoft afirme direcciones de los dominios
del workspace, y una autoridad por dominio publica un issuer con GUID que nunca coincide.
Los tokens tienen que venir de `https://login.microsoftonline.com/<tenant-id>/v2.0`, para tu
client ID, firmados con una clave del `/discovery/v2.0/keys` de ese tenant, sin vencer y con
el nonce que mandó ShareOut.

## Okta: pasos para el admin del cliente

1. Admin Console → **Applications → Create App Integration → OIDC - OpenID Connect →
   Web Application**.
2. Grant type **Authorization Code** (podés exigir PKCE también).
3. Sign-in redirect URI: `https://<tu host de ShareOut>/auth/sso/callback`.
4. **Assignments:** las personas o grupos que pueden usar ShareOut.
5. Mandá el **Client ID**, el **Client secret** y el issuer `https://<org>.okta.com`.

## Asociarlo al workspace (dueño de la instancia)

```bash
curl -X PUT "$ORIGIN/v1/admin/workspaces/$WORKSPACE_ID/sso" \
  -H "Authorization: Bearer $SHAREOUT_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "issuer": "https://login.microsoftonline.com/<tenant-id>/v2.0",
    "client_id": "<application-client-id>",
    "client_secret": "<value del secret>",
    "email_domains": ["acme.com"],
    "button_label": "Entrar con Microsoft",
    "enforced": false
  }'
```

Al guardar se descarga el documento de discovery del issuer. `GET` lee la configuración
(nunca el secret), otro `PUT` la cambia (sin `client_secret` se conserva el guardado) y
`DELETE` la borra.

## Qué ve la gente

- En `/auth/login` del subdominio del workspace, el botón de SSO aparece arriba de los
  demás métodos. `/auth/sso?workspace=<slug>` lo inicia desde cualquier lado.
- El primer login por SSO crea la cuenta (aunque las altas estén pausadas) y suma a la
  persona al workspace como miembro.
- **`"enforced": true`**: las direcciones de los dominios del workspace tienen que usar SSO
  en toda la instancia. Contraseña, código por email, Google y Microsoft las mandan al IdP.

## Problemas comunes

| Síntoma | Solución |
| --- | --- |
| Al guardar dice "use the tenant-specific v2.0 issuer" | Usá `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0` |
| "did not confirm this email address … xms_edov" | Agregá el optional claim `xms_edov` (paso 5); verificá el dominio en **Entra ID → Domain names** |
| "did not share an email address" | Dale al usuario una dirección de mail; agregá el optional claim `email` |
| Microsoft muestra `AADSTS50011` | Falta la redirect URI o no está registrada como **Web** (paso 3) |
| Microsoft muestra `AADSTS7000215` | Se mandó el Secret ID en vez del Value, o el secret venció |
| Microsoft muestra `AADSTS50105` | La asignación es obligatoria y la persona no está asignada |
| Okta muestra `400 access_denied` | La política de sign-on de la app rechazó a la persona; ajustala en Okta |

Referencias de Microsoft:
[OpenID Connect en la plataforma de identidad](https://learn.microsoft.com/es-es/entra/identity-platform/v2-protocols-oidc),
[validación de tokens](https://learn.microsoft.com/es-es/entra/identity-platform/access-tokens#validate-tokens),
[claims del ID token](https://learn.microsoft.com/es-es/entra/identity-platform/id-token-claims-reference),
[optional claims (`email`, `xms_edov`)](https://learn.microsoft.com/es-es/entra/identity-platform/optional-claims-reference).
