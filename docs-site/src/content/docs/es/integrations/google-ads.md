---
title: Google Ads
description: Gasto, clics y conversiones vía conector del workspace y credenciales OAuth pegadas.
---

Consultá datos de la Google Ads API desde un artifact mediante un **conector del
workspace**. Conectá con client ID/secret OAuth, refresh token, developer token
e ID de cliente pegados — ShareOut genera access tokens en el servidor por consulta.

## Configuración (admin del workspace)

1. Obtené un [developer token de Google Ads](https://developers.google.com/google-ads/api/docs/get-started/dev-token).
2. Creá credenciales OAuth y autorizá un usuario con acceso a la cuenta cliente.
3. En ShareOut → **Conectores**, elegí **Google Ads**, pegá los campos y usá
   **Test** antes de guardar.

## Consulta desde un artifact

```javascript
const sdk = await ShareOut.create();

const { data } = await sdk.connection('google_ads').fetch({
  endpoint: 'search',
  body: {
    query: `SELECT campaign.name, metrics.cost_micros, metrics.clicks
            FROM campaign
            WHERE segments.date DURING LAST_30_DAYS`,
  },
});
```

## Relacionado

- [Conexiones del workspace](/es/teams/connections/)
- [Facebook Ads](/es/integrations/facebook-ads/)
