---
title: Facebook Ads
description: Campaign spend, reach, and ROAS via a workspace connector and pasted access token.
---

Query Meta Marketing API data from inside an artifact via a **workspace
connector**. Connect with a pasted long-lived access token plus your ad account
ID — no ShareOut OAuth flow.

## Setup (workspace admin)

1. In [Meta for Developers](https://developers.facebook.com/), create an app
   with Marketing API access and generate a long-lived user access token with
   `ads_read`.
2. Note your ad account ID (e.g. `act_123456789`).
3. In ShareOut → workspace **Connectors**, choose **Facebook Ads**, paste the
   token and account ID, and **Test** before saving.

## Query from an artifact

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

The provider calls `graph.facebook.com/v21.0`. Credentials stay server-side;
the artifact references the connector by name only.

## Rate limits

~200 requests/min per connection, with server-side caching (default 5 min TTL).

## Related

- [Workspace connections](/teams/connections/) — create and test connectors
- [Google Ads](/integrations/google-ads/) — similar token-shim pattern
