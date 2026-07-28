---
title: Facebook Ads
description: Gasto de campañas, alcance y ROAS vía conector del workspace y token de acceso pegado.
---

Consultá datos de la Meta Marketing API desde un artifact mediante un **conector
del workspace**. Conectá con un token de acceso de larga duración pegado más el
ID de tu cuenta publicitaria.

## Configuración (admin del workspace)

1. En [Meta for Developers](https://developers.facebook.com/), creá una app con
   acceso a Marketing API y generá un token con `ads_read`.
2. Anotá el ID de cuenta publicitaria (ej. `act_123456789`).
3. En ShareOut → **Conectores**, elegí **Facebook Ads**, pegá el token y el ID, y
   usá **Test** antes de guardar.

## Consulta desde un artifact

```javascript
const sdk = await ShareOut.create();

const { data } = await sdk.connection('meta_ads').fetch({
  endpoint: 'insights',
  params: {
    date_preset: 'last_30d',
    level: 'campaign',
    fields: 'campaign_name,spend,impressions,clicks,purchase_roas',
  },
});
```

## Relacionado

- [Conexiones del workspace](/es/teams/connections/)
- [Google Ads](/es/integrations/google-ads/)
